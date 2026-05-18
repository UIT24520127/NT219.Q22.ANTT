import { NextResponse } from 'next/server';
import { kmsService } from '@/lib/kms/bao';
import { getEncryptedCEKByKID, logAuditEvent } from '@/lib/track-db';

/**
 * Extract KID from Widevine Challenge
 * Widevine Challenge contains PSSH box with KID information
 * This is a simplified extraction - production code may need more robust parsing
 */
const extractKIDFromChallenge = (challengeBuffer: Buffer): string | null => {
  try {
    // Widevine PSSH box typically contains KID in hex format
    // Look for PSSH signature and extract the 16-byte KID
    const psshSignature = Buffer.from('7073736820', 'hex'); // 'pssh' in hex
    const index = challengeBuffer.indexOf(psshSignature);
    
    if (index !== -1 && index + 36 < challengeBuffer.length) {
      // Extract 16 bytes after PSSH header (offset accounts for box header)
      const kidBuffer = challengeBuffer.slice(index + 20, index + 36);
      const kid = kidBuffer.toString('hex');
      console.log(`🔑 [License] Extracted KID from challenge: ${kid}`);
      return kid;
    }
  } catch (error) {
    console.warn('⚠️  [License] Could not extract KID from challenge, using fallback');
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
    let kid = extractKIDFromChallenge(challengeBuffer);
    
    // Fallback: Try KID from custom header
    if (!kid) {
      kid = request.headers.get('x-kid');
      console.log(`ℹ️  [License] Using KID from header: ${kid}`);
    }

    // Final fallback: Use track-id (legacy support)
    if (!kid) {
      const trackId = request.headers.get('x-track-id') || 'track-test-01';
      console.warn(`⚠️  [License] No KID found, using track-id fallback: ${trackId}`);
      // In production, this should throw an error
      // For now, return mock for testing
    }

    if (!kid) {
      console.error('❌ [License] No KID provided');
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
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
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
