#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('deploy-production-root.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class ProductionReleaseTest(unittest.TestCase):
    def test_no_explicit_flag_does_not_read_pin_or_change_anything(self):
        with patch.object(deploy.os, 'geteuid', return_value=0), patch.object(deploy.sys, 'argv', ['deploy']):
            with patch.object(deploy.sys.stdin, 'read', side_effect=AssertionError('must not read')):
                with self.assertRaises(SystemExit):
                    deploy.main()

    def test_pin_verification_requires_the_root_redirect_and_app(self):
        results = [
            (200, {'Set-Cookie': 'csrf=fixture; Secure'}, '<input name="csrf" value="fixture">'),
            (303, {'Location': '/', 'Set-Cookie': 'gate=fixture; Secure'}, ''),
            (200, {}, 'fixture app'),
        ]
        with patch.object(deploy, 'request', side_effect=results):
            deploy.verify_pin('0007')
        results[1] = (303, {'Location': '/lastochka/', 'Set-Cookie': 'gate=fixture'}, '')
        with patch.object(deploy, 'request', side_effect=results):
            with self.assertRaises(RuntimeError):
                deploy.verify_pin('0007')


if __name__ == '__main__':
    unittest.main()
