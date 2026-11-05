import next from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...next,
  ...nextTs,
  { ignores: ["pipeline/.cache/**", ".next/**", "node_modules/**", "public/sw.js", "next-env.d.ts", "coverage/**"] },
];

export default config;
