/**
 * ECIA EIGP 114.2018 Format 06 barcode parser utilities.
 * Both DigiKey and Mouser use this standard for 2D Data Matrix barcodes.
 */

const RS = '\x1E'; // Record Separator
const GS = '\x1D'; // Group Separator
const EOT = '\x04'; // End of Transmission

/** Extract fields from an ECIA Format 06 barcode string */
export function parseEciaFields(data: string): Map<string, string> {
  const fields = new Map<string, string>();

  // Find the start of actual data after the header
  // Headers: "[)>\x1E06\x1D" or ">[)>\x1E06\x1D"
  let content = data;

  // Strip known prefix variations
  if (content.includes('[)>')) {
    const idx = content.indexOf('[)>') + 3; // after "[)>"
    content = content.slice(idx);
  } else if (content.includes('>[)>')) {
    const idx = content.indexOf('>[)>') + 4; // after ">[)>"
    content = content.slice(idx);
  }

  // Skip past RS06GS header tail if present
  if (content.startsWith(RS + '06' + GS)) {
    content = content.slice((RS + '06' + GS).length);
  } else if (content.startsWith('06' + GS)) {
    content = content.slice(('06' + GS).length);
  }

  // Remove trailing EOT if present
  if (content.endsWith(EOT)) {
    content = content.slice(0, -1);
  }
  if (content.endsWith(RS + EOT)) {
    content = content.slice(0, -(RS + EOT).length);
  }

  // Split by Group Separator
  const segments = content.split(GS);

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed.length === 0) {
      continue;
    }

    // Data identifiers are 1-2 uppercase letters or digits
    // Common ones: 1P, Q, K, 4K, 9D, 1T, 4L, 11K, P, S, 2P, 1V, 3S, 4S
    const match = trimmed.match(/^([A-Z0-9]{1,3})(.+)$/);
    if (match) {
      const [, di, value] = match;
      fields.set(di, value.trim());
    }
  }

  return fields;
}

/** Detect if a barcode string contains ECIA Format 06 structure */
export function isEciaFormat(data: string): boolean {
  if (data.length < 6) {
    return false;
  }
  const hasHeader = data.includes('[)>') || data.includes('>[)>');
  if (!hasHeader) {
    return false;
  }
  // Must contain Group Separator to be valid ECIA with fields
  return data.includes(GS);
}
