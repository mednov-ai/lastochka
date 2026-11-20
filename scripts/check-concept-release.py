#!/usr/bin/env python3
"""Refuse publishing/rolling back to images without the admin concept marker."""
import json
import subprocess
import sys
EXPECTED = 'ADMIN_ENQUIRIES_V1'
ALFA_TEST_PAYMENTS = 'ALFA_TEST_PAYMENTS_V1'
ALFA_DUAL_GATEWAY = 'ALFA_DUAL_GATEWAY_V1'
OPEN_ENDED_AGE = 'OPEN_ENDED_AGE_V1'
CURRENT_SCHEMA = 32
ENQUIRY_AGE_DIRECTION = 'ENQUIRY_AGE_DIRECTION_V1'
PERMANENT_SCHEDULE = 'WEEKLY_INTERVALS_V1'
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
        if labels.get('org.lastochka.alfa-dual-gateway') != ALFA_DUAL_GATEWAY:
            raise ValueError('Image does not support the dual gateway payment contract')
        if labels.get('org.lastochka.enquiry-age-direction') != ENQUIRY_AGE_DIRECTION:
            raise ValueError('Image does not support enquiry age categories')
        if labels.get('org.lastochka.staff-permissions') != 'STAFF_PERMISSIONS_V1':
            raise ValueError('Image does not enforce staff permissions')
        if labels.get('org.lastochka.enquiry-notifications') != 'ENQUIRY_MULTICHANNEL_V1':
            raise ValueError('Image does not support multichannel enquiries and nullable child data')
        if labels.get('org.lastochka.password-lifecycle') != 'PASSWORD_LIFECYCLE_V1':
            raise ValueError('Image does not enforce the current password lifecycle')
        if (image.get('Config', {}).get('Labels') or {}).get('org.lastochka.concept') != EXPECTED:
            raise ValueError('Image is incompatible with the current studio concept')
if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        valid={'Config':{'Labels':{'org.lastochka.concept':EXPECTED,'org.lastochka.schema.min':'32','org.lastochka.schema.max':'32','org.lastochka.enquiry-age-direction':ENQUIRY_AGE_DIRECTION,'org.lastochka.permanent-schedule':PERMANENT_SCHEDULE,'org.lastochka.open-ended-age':OPEN_ENDED_AGE,'org.lastochka.alfa-test-payments':ALFA_TEST_PAYMENTS,'org.lastochka.alfa-dual-gateway':ALFA_DUAL_GATEWAY,'org.lastochka.staff-permissions':'STAFF_PERMISSIONS_V1','org.lastochka.enquiry-notifications':'ENQUIRY_MULTICHANNEL_V1','org.lastochka.password-lifecycle':'PASSWORD_LIFECYCLE_V1'}}}
        validate([valid,valid])
        old_password={'Config':{'Labels':dict(valid['Config']['Labels'])}}
        old_password['Config']['Labels'].pop('org.lastochka.password-lifecycle')
        old_schema={'Config':{'Labels':dict(valid['Config']['Labels'])}}
        old_schema['Config']['Labels']['org.lastochka.schema.max']='31'
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
        old_gateway={'Config':{'Labels':dict(valid['Config']['Labels'])}}
        old_gateway['Config']['Labels'].pop('org.lastochka.alfa-dual-gateway')
        for invalid in ([old_gateway,valid],[valid,old_gateway],[old_permanent,valid],[valid,old_permanent],[old_age,valid],[valid,old_age],[old_payments,valid],[valid,old_payments],[old_permissions,valid],[valid,old_permissions],[old_enquiry,valid],[valid,old_enquiry],[old_schema,valid],[old_password,valid],[valid,{}], [valid], [{'Config':{'Labels':{'org.lastochka.concept':'LEGACY'}}},valid]):
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
