// What does z.email() actually give you?
// Run: npx tsx src/what-is-a-schema.ts

import { z } from "zod";

const emailSchema = z.email();

console.log("\n1. What kind of thing is it?");
console.log("   typeof            :", typeof emailSchema);
console.log("   constructor name  :", emailSchema.constructor.name);

console.log("\n2. What can you do with it? (some of its methods)");
const methods = [
  ...Object.getOwnPropertyNames(Object.getPrototypeOf(emailSchema)),
  ...Object.keys(emailSchema),
].filter((k) => typeof (emailSchema as any)[k] === "function");
console.log("  ", [...new Set(methods)].sort().slice(0, 14).join(", "), "...");

console.log("\n3. It works on its own — no z.object() needed:");
console.log("   .safeParse('billy@example.com') →", emailSchema.safeParse("billy@example.com"));
console.log("   .safeParse('not-an-email')      →", emailSchema.safeParse("not-an-email").success);
console.log("   .safeParse(12345)               →", emailSchema.safeParse(12345).success);

console.log("\n4. z.object() just puts schemas inside a bigger schema:");
const args = z.object({ email: emailSchema });
console.log("   constructor name  :", args.constructor.name);
console.log("   .safeParse({email:'billy@example.com'}).success →", args.safeParse({ email: "billy@example.com" }).success);

console.log("\n5. Schemas build on schemas — each call returns a NEW one:");
const optionalEmail = emailSchema.optional();
console.log(
  "   emailSchema.optional() is a different object:",
  (optionalEmail as unknown) !== (emailSchema as unknown),
);
console.log("   .safeParse(undefined) on the original →", emailSchema.safeParse(undefined).success);
console.log("   .safeParse(undefined) on the optional →", optionalEmail.safeParse(undefined).success);
console.log("");
