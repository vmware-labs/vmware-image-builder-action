import { defineConfig, globalIgnores } from "eslint/config";
import jest from "eslint-plugin-jest";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import githubPlugin from "eslint-plugin-github";

export default defineConfig([globalIgnores([
    "dist/*",
    "lib/*",
    "node_modules/*",
    "**/jest.config.js",
    "src/client/vib/*",
]), {
    files: ["**/*.ts"],

    plugins: {
        jest,
        "@typescript-eslint": typescriptEslint,
        github: githubPlugin,
    },

    languageOptions: {
        globals: {
            ...globals.node,
            ...jest.environments.globals.globals,
        },

        parser: tsParser,
        ecmaVersion: 9,
        sourceType: "module",

        parserOptions: {
            project: "./tsconfig.json",
        },
    },

    rules: {
        "arrow-parens": ["error", "as-needed"],
        camelcase: "off",
        "eslint-comments/no-use": "off",
        "i18n-text/no-en": "off",
        "import/no-namespace": "off",

        indent: ["error", 2, {
            SwitchCase: 1,
        }],

        "max-len": ["error", {
            code: 140,
            tabWidth: 2,
            ignoreTemplateLiterals: true,
        }],

        "no-extra-parens": "error",
        "no-shadow": "off",
        "no-unused-vars": "off",
        "prettier/prettier": "off",
        semi: "off",
        "sort-imports": "off",
        "@typescript-eslint/no-unused-vars": "error",

        "@typescript-eslint/explicit-member-accessibility": ["error", {
            accessibility: "no-public",
        }],

        "@typescript-eslint/no-require-imports": "error",
        "@typescript-eslint/array-type": "error",
        "@typescript-eslint/await-thenable": "error",
        "@typescript-eslint/ban-ts-comment": "error",
        "@typescript-eslint/consistent-type-assertions": "error",

        "@typescript-eslint/explicit-function-return-type": ["error", {
            allowExpressions: true,
        }],

        "@typescript-eslint/no-array-constructor": "error",
        "@typescript-eslint/no-empty-interface": "error",
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-extraneous-class": "error",
        "@typescript-eslint/no-for-in-array": "error",
        "@typescript-eslint/no-inferrable-types": "error",
        "@typescript-eslint/no-misused-new": "error",
        "@typescript-eslint/no-namespace": "error",
        "@typescript-eslint/no-non-null-assertion": "warn",
        "@typescript-eslint/no-shadow": "error",
        "@typescript-eslint/no-unnecessary-qualifier": "error",
        "@typescript-eslint/no-unnecessary-type-assertion": "error",
        "@typescript-eslint/no-useless-constructor": "error",
        "@typescript-eslint/no-var-requires": "error",
        "@typescript-eslint/prefer-for-of": "warn",
        "@typescript-eslint/prefer-function-type": "warn",
        "@typescript-eslint/prefer-includes": "error",
        "@typescript-eslint/prefer-string-starts-ends-with": "error",
        "@typescript-eslint/promise-function-async": "error",
        "@typescript-eslint/require-array-sort-compare": "error",
        "@typescript-eslint/restrict-plus-operands": "error",
        "@typescript-eslint/unbound-method": "error",
    },
}]);
