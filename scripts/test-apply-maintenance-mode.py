#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('switch', Path(__file__).with_name('apply-maintenance-mode.py'))
switch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(switch)


class ApplyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'etc/nginx/sites-available').mkdir(parents=True)
        for zone in ('test', 'production'):
            (self.root / 'etc/lastochka' / zone).mkdir(parents=True)
            (self.root / 'etc/nginx/sites-available' / ('lastochka-' + zone)).write_text('old-' + zone)
        self.real_path = Path

    def tearDown(self):
        self.tmp.cleanup()

    def path(self, value):
        return self.root / str(value).lstrip('/')

    def exercise(self, fail_reload=False, root_app=False):
        commands = []
        def command(*args):
            commands.append(args)
            if fail_reload and args == ('systemctl', 'reload', 'nginx') and commands.count(args) == 1:
                raise RuntimeError('synthetic reload failure')
            return ''
        def response(host, path):
            return ((200, None) if root_app else (308, '/lastochka/')) if path == '/' else (200, None)
        with patch.object(switch, 'Path', self.path), patch.object(switch, 'render', return_value=b'new-test'), \
             patch.object(switch, 'verify_shadow'), patch.object(switch, 'run', side_effect=command), \
             patch.object(switch, 'check_backup_directory'), \
             patch.object(switch, 'request', side_effect=response), patch.object(switch.os, 'getuid', return_value=0):
            # Temporary fixtures are owned by the current user; emulate only the owner validation.
            real_lstat = self.real_path.lstat
            def root_owned(path):
                st = real_lstat(path)
                return type('Stat', (), {'st_mode': st.st_mode, 'st_uid': 0})()
            with patch.object(self.real_path, 'lstat', root_owned), patch.object(switch, 'sha', side_effect=lambda p: p.read_bytes()):
                if fail_reload:
                    with self.assertRaises(RuntimeError):
                        switch.apply('test', 'public', root_app)
                else:
                    switch.apply('test', 'public', root_app)
        return commands

    def test_target_only(self):
        self.exercise()
        self.assertEqual((self.root / 'etc/nginx/sites-available/lastochka-test').read_text(), 'new-test')
        self.assertEqual((self.root / 'etc/nginx/sites-available/lastochka-production').read_text(), 'old-production')

    def test_reload_failure_restores_original(self):
        commands = self.exercise(fail_reload=True)
        self.assertEqual((self.root / 'etc/nginx/sites-available/lastochka-test').read_text(), 'old-test')
        self.assertEqual((self.root / 'etc/nginx/sites-available/lastochka-production').read_text(), 'old-production')
        self.assertEqual(commands.count(('systemctl', 'reload', 'nginx')), 2)

    def test_root_target_and_failed_reload(self):
        self.exercise(fail_reload=True, root_app=True)
        self.assertEqual((self.root / 'etc/nginx/sites-available/lastochka-test').read_text(), 'old-test')
        self.exercise(root_app=True)
        self.assertEqual((self.root / 'etc/nginx/sites-available/lastochka-test').read_text(), 'new-test')

    def test_config_rejects_missing_wrong_zone_unknown_mode_and_insecure_permissions(self):
        config = self.root / 'mode.json'
        with self.assertRaises(FileNotFoundError):
            switch.read_config(config, 'test')
        real_lstat = self.real_path.lstat
        def root_owned(path):
            st = real_lstat(path)
            return type('Stat', (), {'st_mode': st.st_mode, 'st_uid': 0})()
        with patch.object(self.real_path, 'lstat', root_owned):
            config.write_text('{"zone":"production","mode":"public"}')
            config.chmod(0o600)
            with self.assertRaises(ValueError):
                switch.read_config(config, 'test')
            config.write_text('{"zone":"test","mode":"typo"}')
            with self.assertRaises(ValueError):
                switch.read_config(config, 'test')
            config.write_text('{"zone":"test","mode":"public"}')
            self.assertEqual(switch.read_config(config, 'test')['mode'], 'public')
            config.write_text('{"zone":"test","mode":"public","app_base":"/"}')
            self.assertEqual(switch.read_config(config, 'test')['app_base'], '/')
            config.write_text('{"zone":"test","mode":"public","app_base":"//other/"}')
            with self.assertRaises(ValueError):
                switch.read_config(config, 'test')
            config.chmod(0o644)
            with self.assertRaises(ValueError):
                switch.read_config(config, 'test')


if __name__ == '__main__':
    unittest.main()
