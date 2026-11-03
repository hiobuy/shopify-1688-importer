import type { PrismaClient } from "@prisma/client";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { encrypt, decrypt } from "./crypto.server";
// Clone before encrypting so authenticate.admin receives a usable token in memory.
export class EncryptedSessionStorage extends PrismaSessionStorage<PrismaClient> {
  override async storeSession(
    session: Parameters<PrismaSessionStorage<PrismaClient>["storeSession"]>[0],
  ) {
    const copy = Object.assign(
      Object.create(Object.getPrototypeOf(session)),
      session,
    );
    if (copy.accessToken) copy.accessToken = encrypt(copy.accessToken);
    if (copy.refreshToken) copy.refreshToken = encrypt(copy.refreshToken);
    return super.storeSession(copy);
  }
  override async loadSession(id: string) {
    const session = await super.loadSession(id);
    if (session?.accessToken)
      session.accessToken = decrypt(session.accessToken);
    if (session?.refreshToken)
      session.refreshToken = decrypt(session.refreshToken);
    return session;
  }
  override async findSessionsByShop(shop: string) {
    const sessions = await super.findSessionsByShop(shop);
    return sessions.map((session) => {
      if (session.accessToken)
        session.accessToken = decrypt(session.accessToken);
      if (session.refreshToken)
        session.refreshToken = decrypt(session.refreshToken);
      return session;
    });
  }
}
