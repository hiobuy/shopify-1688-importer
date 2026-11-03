import { randomBytes } from "node:crypto";
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SHOPIFY_APP_URL = "https://importer.example.com";
