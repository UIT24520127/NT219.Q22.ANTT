# Audio Watermark Helper

This directory contains the watermark helper used by the ingest pipeline.

## Behavior

- `security/watermark/watermark.sh` applies a low-amplitude high-frequency tone to the source audio.
- The watermark step is optional and controlled via `WATERMARK_ENABLED`.
- The ingest/packager pipeline uses this script before DASH packaging and Cloudflare R2 upload.

## Runtime requirements

- `ffmpeg` must be installed and available on `PATH`.
- `WATERMARK_ENABLED=true` enables the watermark stage.
- `WATERMARK_FREQUENCY`, `WATERMARK_AMPLITUDE`, `WATERMARK_CODEC`, and `WATERMARK_BITRATE` can be adjusted via environment variables.
