#!/usr/bin/env python3
"""Refuse publishing/rolling back to images without the admin concept marker."""
import json
import subprocess
import sys
EXPECTED = 'ADMIN_ENQUIRIES_V1'
INLINE_RECURRENCE = 'INLINE_RECURRENCE_V1'
SESSION_CORRECTIONS = 'SESSION_CORRECTIONS_V1'
ALFA_TEST_PAYMENTS = 'ALFA_TEST_PAYMENTS_V1'
OPEN_ENDED_AGE = 'OPEN_ENDED_AGE_V1'
CURRENT_SCHEMA = 27
PERMANENT_SCHEDULE = 'PERMANENT_SCHEDULE_V1'
def validate(images):
    if len(images) != 2:
        raise ValueError('Exactly backend and frontend images are required')
    for image in images:
        labels=image.get('Config', {}).get('Labels') or {}
        if not (int(labels.get('org.lastochka.schema.min','0')) <= CURRENT_SCHEMA <= int(labels.get('org.lastochka.schema.max','0'))):
            raise ValueError(f'Image is incompatible with schema {CURRENT_SCHEMA}')
        if labels.get('org.lastochka.open-ended-age') != OPEN_ENDED_AGE:
            raise ValueError('Image does not support open-ended age ranges')
        if labels.get('org.lastochka.permanent-schedule') != PERMANENT_SCHEDULE:
            raise ValueError('Image does not protect permanent schedule rules')
        if labels.get('org.lastochka.alfa-test-payments') != ALFA_TEST_PAYMENTS:
            raise ValueError('Image does not support the test payment lifecycle')
        if labels.get('org.lastochka.staff-permissions') != 'STAFF_PERMISSIONS_V1':
            raise ValueError('Image does not enforce staff permissions')
        if labels.get('org.lastochka.enquiry-notifications') != 'ENQUIRY_MULTICHANNEL_V1':
            raise ValueError('Image does not support multichannel enquiries and nullable child data')
        if labels.get('org.lastochka.recurring-groups') != 'RECURRING_GROUPS_V1':
            raise ValueError('Image does not support recurring groups and plan invalidation')
        if labels.get('org.lastochka.password-lifecycle') != 'PASSWORD_LIFECYCLE_V1':
            raise ValueError('Image does not enforce the current password lifecycle')
        if (image.get('Config', {}).get('Labels') or {}).get('org.lastochka.concept') != EXPECTED:
            raise ValueError('Image is incompatible with the current studio concept')
    backend_labels = images[0].get('Config', {}).get('Labels') or {}
    frontend_labels = images[1].get('Config', {}).get('Labels') or {}
    if (frontend_labels.get('org.lastochka.inline-recurrence') == INLINE_RECURRENCE and
            backend_labels.get('org.lastochka.inline-recurrence') != INLINE_RECURRENCE):
        raise ValueError('This frontend needs a backend with inline recurrence support')
    if (frontend_labels.get('org.lastochka.session-corrections') == SESSION_CORRECTIONS and
            backend_labels.get('org.lastochka.session-corrections') != SESSION_CORRECTIONS):
        raise ValueError('This frontend needs a backend with individual session corrections')
if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        valid={'Config':{'Labels':{'org.lastochka.concept':EXPECTED,'org.lastochka.schema.min':'27','org.lastochka.schema.max':'27','org.lastochka.permanent-schedule':PERMANENT_SCHEDULE,'org.lastochka.open-ended-age':OPEN_ENDED_AGE,'org.lastochka.alfa-test-payments':ALFA_TEST_PAYMENTS,'org.lastochka.staff-permissions':'STAFF_PERMISSIONS_V1','org.lastochka.enquiry-notifications':'ENQUIRY_MULTICHANNEL_V1','org.lastochka.recurring-groups':'RECURRING_GROUPS_V1','org.lastochka.password-lifecycle':'PASSWORD_LIFECYCLE_V1'}}}
        validate([valid,valid])
        old_password={'Config':{'Labels':dict(valid['Config']['Labels'])}}
        old_password['Config']['Labels'].pop('org.lastochka.password-lifecycle')
        old_series={'Config':{'Labels':dict(valid['Config']['Labels'])}}
        old_series['Config']['Labels'].pop('org.lastochka.recurring-groups')
        old_schema={'Config':{'Labels':dict(valid['Config']['Labels'])}}
        old_schema['Config']['Labels']['org.lastochka.schema.max']='15'
        old_age={'Config':{'Labels':dict(valid['Config']['Labels'])}}
        old_age['Config']['Labels'].pop('org.lastochka.open-ended-age')
        old_permanent={'Config':{'Labels':dict(valid['Config']['Labels'])}}
        old_permanent['Config']['Labels'].pop('org.lastochka.permanent-schedule')
        old_enquiry={'Config':{'Labels':dict(valid['Config']['Labels'])}}
        old_enquiry['Config']['Labels'].pop('org.lastochka.enquiry-notifications')
        old_permissions={'Config':{'Labels':dict(valid['Config']['Labels'])}}
        old_permissions['Config']['Labels'].pop('org.lastochka.staff-permissions')
        old_payments={'Config':{'Labels':dict(valid['Config']['Labels'])}}
        old_payments['Config']['Labels'].pop('org.lastochka.alfa-test-payments')
        inline = {'Config': {'Labels': dict(valid['Config']['Labels'])}}
        inline['Config']['Labels']['org.lastochka.inline-recurrence'] = INLINE_RECURRENCE
        validate([inline, inline])
        validate([inline, valid])  # The previous frontend works with the new backend.
        corrections = {'Config': {'Labels': dict(inline['Config']['Labels'])}}
        corrections['Config']['Labels']['org.lastochka.session-corrections'] = SESSION_CORRECTIONS
        validate([corrections, corrections])
        validate([corrections, inline])
        try: validate([inline, corrections])
        except ValueError: pass
        else: raise AssertionError('Corrections frontend accepted an incompatible backend')
        try: validate([valid, inline])
        except ValueError: pass
        else: raise AssertionError('The new frontend was accepted with an old backend')
        for invalid in ([old_permanent,valid],[valid,old_permanent],[old_age,valid],[valid,old_age],[old_payments,valid],[valid,old_payments],[old_permissions,valid],[valid,old_permissions],[old_enquiry,valid],[valid,old_enquiry],[old_series,valid],[valid,old_series],[old_schema,valid],[old_password,valid],[valid,{}], [valid], [{'Config':{'Labels':{'org.lastochka.concept':'LEGACY'}}},valid]):
            try: validate(invalid)
            except ValueError: pass
            else: raise AssertionError('Unsafe release was accepted')
        print('Concept release gate: positive/negative checks passed')
    else:
        result=subprocess.run(['docker','image','inspect',*sys.argv[1:]],capture_output=True,text=True,check=True)
        try:
            validate(json.loads(result.stdout))
        except ValueError as error:
            raise SystemExit(str(error))
        print('Both images support '+EXPECTED)
