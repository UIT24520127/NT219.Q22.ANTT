#!/usr/bin/env node
/**
 * Chạy script này MỘT LẦN để tạo DPoP keypair cho Keycloak admin:
 *
 *   node scripts/generate-dpop-keypair.js
 *
 * Copy output vào file .env:
 *   KEYCLOAK_DPOP_PRIVATE_JWK={"kty":"EC","crv":"P-256",...}
 *
 * KHÔNG commit file .env vào Git.
 * Thêm .env vào .gitignore nếu chưa có.
 */

const { generateKeyPairSync } = require('crypto');

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = privateKey.export({ format: 'jwk' });

console.log('\n✅ DPoP keypair đã tạo xong.\n');
console.log('Thêm dòng sau vào file .env của bạn:\n');
console.log(`KEYCLOAK_DPOP_PRIVATE_JWK=${JSON.stringify(jwk)}`);
console.log('\n⚠️  Giữ bí mật — không commit vào Git!\n');
