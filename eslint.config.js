// Monorepo uchun yagona ESLint (flat config).
// Har bir workspace `eslint .` ni o'z papkasida ishga tushiradi; ESLint shu faylni yuqoriga qarab topadi.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const UI_TEXT_MESSAGE =
  "UI matnini to'g'ridan-to'g'ri yozmang — `t` (src/i18n/uz.ts) lug'atidan foydalaning.";
/** Foydalanuvchiga ko'rinadigan (yoki ekran o'quvchi o'qiydigan) matnli prop'lar. */
const UI_TEXT_PROPS = [
  'placeholder',
  'title',
  'alt',
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'label',
  'description',
  'header',
  'hint',
  'allLabel',
  'clearLabel',
  'confirmLabel',
  'cancelLabel',
].join('|');

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.turbo/**',
      'backend/src/generated/**',
      '**/src/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Umumiy qoidalar (barcha TypeScript kodi)
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        // NestJS DI decorator metadata uchun konstruktor tiplari value-import bo'lib qolishi kerak.
        { prefer: 'type-imports', disallowTypeAnnotations: false, fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // Backend: Node muhiti, console o'rniga logger (pino) majburiy
  {
    files: ['backend/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': 'error',
      // NestJS konstruktor injection metadata'si uchun class importlari value bo'lishi shart.
      '@typescript-eslint/consistent-type-imports': 'off',
      // SQL injection himoyasi (SECURITY §11): raw SQL faqat tagged template ($queryRaw`…${v}`) orqali.
      'no-restricted-properties': [
        'error',
        ...['$queryRawUnsafe', '$executeRawUnsafe'].map((property) => ({
          property,
          message:
            'Taqiqlangan: SQL injection xavfi. $queryRaw`…${value}` (avtomatik parametrlash) ishlating.',
        })),
      ],
    },
  },

  // Frontend: React hooks qoidalari, XSS himoyasi
  {
    files: ['frontend/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'XSS xavfi: dangerouslySetInnerHTML taqiqlangan.',
        },
      ],
      // Zod o'zbekcha xabarlar bilan sozlangan modul orqaligina (bundle'dan tashqarida, Phase 14).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'zod',
              message: "zod'ni '@/shared/forms/zod' orqali import qiling.",
              allowTypeImports: true,
            },
            {
              name: '@hookform/resolvers/zod',
              message: "zodResolver'ni '@/shared/forms/zod' orqali import qiling.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ['frontend/src/shared/forms/zod.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // REQ-002: UI matnlari faqat i18n lug'atidan (src/i18n/uz.ts) olinadi.
  // JSX ichida qo'lda yozilgan harfli matn — xato.
  {
    files: [
      'frontend/src/app/**/*.tsx',
      'frontend/src/features/**/*.tsx',
      'frontend/src/shared/components/**/*.tsx',
      'frontend/src/shared/ui/**/*.tsx',
    ],
    ignores: ['frontend/src/**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'XSS xavfi: dangerouslySetInnerHTML taqiqlangan.',
        },
        {
          selector: 'JSXText[value=/[A-Za-z\\u0400-\\u04FF]/]',
          message: UI_TEXT_MESSAGE,
        },
        // Phase 14 (AC-25): foydalanuvchiga ko'rinadigan atributlar va `{'matn'}` ham lug'atdan.
        {
          selector: `JSXAttribute[name.name=/^(${UI_TEXT_PROPS})$/] > Literal[value=/[A-Za-z\\u0400-\\u04FF]/]`,
          message: UI_TEXT_MESSAGE,
        },
        {
          selector: `JSXAttribute[name.name=/^(${UI_TEXT_PROPS})$/] > JSXExpressionContainer > :matches(Literal[value=/[A-Za-z\\u0400-\\u04FF]/], TemplateLiteral[quasis.0.value.raw=/[A-Za-z]/])`,
          message: UI_TEXT_MESSAGE,
        },
        {
          selector:
            'JSXElement > JSXExpressionContainer > :matches(Literal[value=/[A-Za-z\\u0400-\\u04FF]/], TemplateLiteral[quasis.0.value.raw=/[A-Za-z]/])',
          message: UI_TEXT_MESSAGE,
        },
        {
          selector:
            "CallExpression[callee.object.name='toast'] > :matches(Literal[value=/[A-Za-z\\u0400-\\u04FF]/], TemplateLiteral[quasis.0.value.raw=/[A-Za-z]/])",
          message: UI_TEXT_MESSAGE,
        },
        // Forma sxemalaridagi xabarlar (`{ error: '...' }`, `setError(..., { message: '...' })`) ham.
        {
          selector:
            'Property[key.name=/^(error|message)$/] > :matches(Literal[value=/[A-Za-z\\u0400-\\u04FF]/], TemplateLiteral[quasis.0.value.raw=/[A-Za-z]/])',
          message: UI_TEXT_MESSAGE,
        },
      ],
    },
  },

  // Frontend QA skriptlari (headless Chrome orqali UI tekshiruvi) — Node muhitida ishlaydi
  {
    files: ['frontend/scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off', 'no-empty': 'off' },
  },

  // Test fayllari: biroz yumshoqroq
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  prettier,
);
