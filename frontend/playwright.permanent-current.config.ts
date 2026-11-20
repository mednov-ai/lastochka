import { defineConfig } from '@playwright/test';
import base from './playwright.permanent-isolated.config';

export default defineConfig({ ...base, testMatch: 'schedule-selection-current.spec.ts' });
