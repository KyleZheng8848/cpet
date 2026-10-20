import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

/**
 * 取舍：只保留「会咬人」的规则，不做格式化。
 * 这份代码此前从未 lint 过，如果一上来就开满严格规则，输出会有几百条，
 * 结果是没人跑 lint —— 门禁的价值在于永远是绿的，红了就一定是真问题。
 *
 * error（阻断 CI）：会导致运行时错误或状态错乱的
 * warn（不阻断，但用 --max-warnings 卡住上限，只能减不能增）：清理型
 */
export default tseslint.config(
  {
    ignores: [
      'out/**',
      '.cache/**',
      'release/**',
      'dist/**',
      'node_modules/**',
      'resources/**',
      'build/**',
      'assets/**',
      'docs/**',
      // 打进安装包的 Skill 产线脚本，不是应用运行时；别占 max-warnings 额度
      '.cursor/**',
      '.venv-rembg/**',
      'index.js',
      '**/*.py'
    ]
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 主进程 / preload：Node 环境
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' }
    }
  },

  // 渲染进程：浏览器环境 + React Hooks
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } }
    },
    rules: {
      // 这两条直接对着本项目 0.3.72「用过期 React state 覆盖 conversationsRef」那类 bug
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },

  // shared：主/渲染都会 import，不假设环境
  {
    files: ['src/shared/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' }
    }
  },

  // 构建与皮肤脚本：Node，允许 console 与 require
  // 用 **/scripts/** 而不是 scripts/**：皮肤生成脚本还有一份在 .cursor/skills/ 下，
  // 只锚根目录会漏掉它们，于是整片报 'process is not defined'。
  {
    files: [
      '**/scripts/**/*.{mjs,cjs,mts}',
      '.cursor/**/*.{mjs,cjs}',
      '*.config.{ts,mjs}',
      'electron.vite.config.ts'
    ],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' }
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off'
    }
  },

  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } }
  },

  // 全局取舍
  {
    files: ['**/*.{ts,tsx,mts,mjs,cjs}'],
    rules: {
      // 未用变量：以 _ 开头视为故意保留（解构丢弃、占位参数）
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true
        }
      ],
      // Electron 主进程解析各家 CLI 的任意 JSON，any 是现实需要，不值得为它红
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      // 这条真能咬人：if (x = 1) 之类
      'no-cond-assign': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      // 空 catch 会吞掉引擎错误，本项目最怕这个
      'no-empty': ['error', { allowEmptyCatch: false }],

      // `let x = ''` 后立刻在 try 里赋值，是本项目通用的防御式写法；
      // 16 处命中里没有一处是 bug，降级为 warn，别让门禁被噪音撑红。
      'no-useless-assignment': 'warn',

      // cliSanitize.ts 的职责就是剥掉 ANSI/OSC 控制序列，正则里出现控制字符是正确的。
      'no-control-regex': 'off',

      // 但代理对拆分是真错（会误删模型正文），这条保持 error。
      'no-misleading-character-class': 'error',

      // 托盘菜单里 `visible ? hide() : show()` 这种三元当语句用是可读的，放行；
      // 其余「写了表达式却什么都没做」仍然报错。
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true }
      ]
    }
  }
)
