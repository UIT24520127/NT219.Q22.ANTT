import { NextResponse } from 'next/server';
import { kmsService } from '@/lib/kms/bao';
import { getEncryptedCEKByKID, logAuditEvent } from '@/lib/track-db';

/**
 * Extract KID from Widevine Challenge
 * Widevine Challenge contains PSSH box with KID information
 * Parses ISOBMFF box structure more robustly
 */
const extractKIDFromChallenge = (challengeBuffer: Buffer): string | null => {
  try {
    // Search for PSSH box signature (4-byte box type 'pssh')
    const psshSignature = Buffer.from('pssh');
    let offset = 0;
    
    while (offset < challengeBuffer.length - 8) {
      offset = challengeBuffer.indexOf(psshSignature, offset);
      if (offset === -1) break;
      
      // Validate box header: size field should be at offset-4
      if (offset >= 4) {
        const boxSize = challengeBuffer.readUInt32BE(offset - 4);
        // Sanity check: box size should be reasonable
        if (boxSize > 8 && boxSize < 65536 && offset + boxSize <= challengeBuffer.length) {
          // PSSH box found with valid size
          // KID is typically at offset + 12 (after version/flags and system ID)
          if (offset + 28 <= challengeBuffer.length) {
            const kidBuffer = challengeBuffer.slice(offset + 12, offset + 28);
            const kid = kidBuffer.toString('hex');
            console.log(`🔑 [License] Extracted KID from challenge: ${kid}`);
            return kid;
          }
        }
      }
      offset++;
    }
  } catch (error) {
    console.warn('⚠️  [License] Could not extract KID from challenge, trying fallback methods');
  }
  return null;
};

export async function POST(request: Request) {
  try {
    // 1. Receive Widevine Challenge (binary data from Shaka Player)
    const challengeArrayBuffer = await request.arrayBuffer();
    const challengeBuffer = Buffer.from(challengeArrayBuffer);

    if (challengeBuffer.length === 0) {
      return NextResponse.json({ error: 'Empty Widevine Challenge' }, { status: 400 });
    }

    console.log(`📡 [License] Received challenge: ${challengeBuffer.length} bytes`);

    // 2. Extract KID from challenge or use headers as fallback
    let kid: string | null = extractKIDFromChallenge(challengeBuffer);
    
    // Fallback: Try KID from custom header
    if (!kid) {
      kid = request.headers.get('x-kid');
      if (kid) {
        console.log(`ℹ️  [License] Using KID from header: ${kid}`);
      }
    }

    // Error if no KID found
    if (!kid) {
      console.error('❌ [License] No KID provided in challenge or headers');
      return NextResponse.json({ error: 'No KID provided in challenge or headers' }, { status: 400 });
    }

    // 3. Query database for encrypted CEK using KID
    console.log(`🔍 [License] Looking up CEK for KID: ${kid}`);
    const encryptedCek = await getEncryptedCEKByKID(kid);

    if (!encryptedCek) {
      console.error(`❌ [License] CEK not found for KID: ${kid}`);
      await logAuditEvent('LICENSE_FAILED', undefined, kid, 'SYSTEM', 'CEK not found');
      return NextResponse.json({ error: 'Content not available' }, { status: 404 });
    }

    // 4. Decrypt CEK from OpenBao KMS (Envelope Encryption pattern)
    console.log('🔓 [License] Decrypting CEK from OpenBao...');
    const plaintextCek = await kmsService.decryptKey(encryptedCek);

    // Validate CEK format (should be 64 hex characters for 256-bit key)
    if (plaintextCek.length !== 64 || !/^[0-9a-f]+$/i.test(plaintextCek)) {
      console.error('❌ [License] Invalid CEK format after decryption');
      throw new Error('Invalid CEK format');
    }

    console.log(`✅ [License] CEK decrypted successfully for KID: ${kid}`);

    // 5. Build Widevine License Response (binary format)
    // Standard format: DRM Header + CEK
    const drmHeader = Buffer.from([0x00, 0x01, 0x44, 0x52, 0x4d, 0x4c, 0x49, 0x43]); // DRMLIC
    const cekBuffer = Buffer.from(plaintextCek, 'hex');
    const licenseResponsePayload = Buffer.concat([drmHeader, cekBuffer]);

    console.log(`📦 [License] License response ready: ${licenseResponsePayload.length} bytes`);

    // 6. Log audit event
    await logAuditEvent('LICENSE_ISSUED', undefined, kid, 'SYSTEM', 'license');

    // 7. Return binary response to Shaka Player
    return new NextResponse(licenseResponsePayload, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-kid, x-track-id',
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error('❌ [License] Error in license proxy:', message);
    return NextResponse.json({ 
      error: 'License generation failed',
      details: process.env.NODE_ENV === 'development' ? message : undefined
    }, { status: 500 });
  }
}

// Handle CORS preflight
export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-kid, x-track-id',
    },
  });
}
