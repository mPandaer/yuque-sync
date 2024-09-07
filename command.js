#!/usr/bin/env node
const { Command } = require("commander");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const os = require("os");

// 配置文件路径
const CONFIG_DIR = path.join(os.homedir(), "yuque-sync");
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
// const CONFIG_PATH = "config.json";

// 解析语雀代码块
const parseCodeBlock = (node) => {
  const value = node.getAttribute("value");
  const decoded = decodeURIComponent(value).replace(/^data:/, "");
  const parsed = JSON.parse(decoded);
  const codeBlock = parsed.code || "";
  const codeMode = parsed.mode || "txt";
  return `\n\`\`\`${codeMode}\n${codeBlock}\n\`\`\`\n`;
};

// 下载任务队列
const downloadQueue = [];

// 异步处理的下载函数
const downloadImages = async () => {
  while (downloadQueue.length > 0) {
    const { imageNetSrc, imagePath } = downloadQueue.shift();
    try {
      // 1. 创建 images 目录（如果不存在）
      const imagesDir = path.dirname(imagePath);
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
      }

      // 2. 下载图片
      const response = await fetch(imageNetSrc);
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.statusText}`);
      }

      // 3. 从响应中获取缓冲区
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 4. 将缓冲区保存到文件中
      await promisify(fs.writeFile)(imagePath, buffer);
    } catch (error) {
      console.error(`Error downloading image ${imageNetSrc}`, error);
    }
  }
};

// 用于添加下载任务的函数
const addDownloadTask = (imageNetSrc, imageDir) => {
  const imageName = path.basename(imageNetSrc);
  const imagePath = path.join(imageDir, imageName);
  downloadQueue.push({ imageNetSrc, imagePath });

  // 异步调用下载函数
  downloadImages();

  return imagePath;
};

const parseImage = (node) => {
  const value = node.getAttribute("value");
  const decoded = decodeURIComponent(value).replace(/^data:/, "");
  const parsed = JSON.parse(decoded);

  const imageNetSrc = parsed.src || "";
  const imagesDir = "images";
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  let localPath = "";
  if (imageNetSrc !== "") {
    // 保存到当前目录下的images的目录中
    localPath = addDownloadTask(imageNetSrc, imagesDir);
  }
  const imageName = parsed.name || "image_name";
  return `\n![${imageName}](${localPath})\n\n`;
};

const parseCardNode = function (node) {
  const types = ["CARD", "card"];
  if (types.includes(node.nodeName)) {
    if (node.getAttribute("name") === "codeblock") {
      return parseCodeBlock(node);
    }
    if (node.getAttribute("name") === "image") {
      const mdImage = parseImage(node);
      return mdImage;
    }
    return "parse card fail";
  } else {
    // 递归检查子节点
    if (node.childNodes) {
      for (let childNode of node.childNodes) {
        const result = parseCardNode(childNode);
        // 如果找到有效结果，返回它
        if (result !== "parse missing") {
          return result;
        }
      }
    }
    return "parse missing";
  }
};

// 配置
const TurndownService = require("turndown");
const turndownService = new TurndownService({
  blankReplacement(content, node) {
    const parseContent = parseCardNode(node);
    console.log("parse lake block: ", node.nodeName, " ", parseContent);
    return parseContent;
  },
});

const program = new Command();

program
  .command("config")
  .argument("<key>", "Configuration key")
  .argument("<value>", "Configuration value")
  .description("Set configuration key and value")
  .action((key, value) => {
    console.log("path:", CONFIG_PATH);
    const config = fs.existsSync(CONFIG_PATH)
      ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))
      : {};

    config[key] = value;

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

    console.log(`Configuration ${key} set to ${value}`);
  });

program
  .command("sync")
  .option("--book <bookId>", "Book ID to sync")
  .option("--doc <docId>", "Document ID to sync")
  .description("Sync the Yuque document to markdown")
  .action(async (options) => {
    console.log(options);
    const { book, doc } = options;
    console.log("bookId: ", book, "docId: ", doc);
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      const { token, session } = config;
      console.log("token: ", token, "session: ", session);

      const url = `https://www.yuque.com/api/docs/${doc}?book_id=${book}`;
      console.log("url: ", url);

      const headers = {
        accept: "application/json",
        "accept-language": "zh-CN,zh;q=0.9",
        "cache-control": "no-cache",
        "content-type": "application/json",
        pragma: "no-cache",
        "sec-ch-ua":
          '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-csrf-token": token,
        "x-login": "mpandaer",
        "x-requested-with": "XMLHttpRequest",
        cookie: `_yuque_session=${session};yuque_ctoken=${token};`,
        Referer: "https://www.yuque.com/mpandaer/gzsx8e/rs3k6mm7t9ssn4ud",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      };

      const response = await fetch(url, { headers, method: "GET" });
      if (!response.ok) {
        throw new Error("Network response was not ok " + response.statusText);
      }

      const data = await response.json(); // 解析JSON响应
      const html = data.data.content;
      const title = data.data.title;
      const markdown = turndownService.turndown(html);
      const filePath = `${title}.md`;

      fs.writeFile(filePath, markdown, (err) => {
        if (err) {
          console.error("Error writing to file", err);
        } else {
          console.log("Markdown saved to", filePath);
        }
      });
    } catch (error) {
      console.error("There was a problem with the fetch operation:", error);
    }
  });

program.parse(process.argv);
