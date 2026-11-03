import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Luật giữ hệ thống theme 3 tầng:
// component chỉ dùng class ngữ nghĩa, màu thật chỉ nằm trong styles/themes/*.css.
const PALETTE_CLASS =
  "\\b(bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|placeholder|caret|shadow)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)\\b";
const ARBITRARY_HEX = "-\\[#[0-9a-fA-F]{3,8}\\]";
const DARK_VARIANT = "(^|\\s)dark:";

const themeRule = (pattern, message) => [
  { selector: `Literal[value=/${pattern}/]`, message },
  { selector: `TemplateElement[value.raw=/${pattern}/]`, message },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "cn",
              message:
                'Import cn từ "@/lib/utils" — bản đó đã đăng ký token cỡ chữ/bóng của theme.',
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...themeRule(
          PALETTE_CLASS,
          "Không dùng class bảng màu cứng (bg-red-500, text-zinc-600...). Dùng token ngữ nghĩa: bg-primary, text-muted-foreground..."
        ),
        ...themeRule(
          ARBITRARY_HEX,
          "Không dùng mã hex trong class. Khai báo biến trong styles/themes/*.css + token trong styles/tokens.css."
        ),
        ...themeRule(
          DARK_VARIANT,
          "Không dùng biến thể dark: — màu chế độ tối đến từ preset (styles/themes/*.css)."
        ),
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
