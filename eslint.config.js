// 程式檢查：只抓「用到沒定義的變數」這類一定會壞掉的錯（npm run lint；npm run check 也會跑）
import globals from "globals";

export default [
  { ignores: ["public/vendor/**", "node_modules/**", "tests/node_modules/**", "tests/output/**", "public/tutorial/**", "docs_tmp/**"] },
  {
    files: ["server/**/*.js", "functions/**/*.js", "scripts/**/*.mjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node, ...globals.worker } },
    rules: { "no-undef": "error" },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.browser, supabase: "readonly", App: "writable" } },
    rules: { "no-undef": "error" },
  },
];
