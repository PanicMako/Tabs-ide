import { verifyCodeOssExtensionMedia } from "./lib/code-oss-media";
const root = process.argv[2];
if (!root) throw new Error("Provide the packaged Code-OSS extensions directory");
console.log(JSON.stringify(verifyCodeOssExtensionMedia(root)));
