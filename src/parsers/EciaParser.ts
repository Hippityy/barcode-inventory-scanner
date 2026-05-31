/**
 * ECIA EIGP 114.2018 Format 06 barcode parser utilities.
 * Both DigiKey and Mouser use this standard for 2D Data Matrix barcodes.
 */

const RS = '\x1E'; // Record Separator
const GS = '\x1D'; // Group Separator
const EOT = '\x04'; // End of Transmission

/** Known ECIA data identifiers, longest first to avoid partial matches */
const KNOWN_DIS = [
  '11K', '4L', '4K', '9D', '1T', '1P', '1V', '2P', '3S', '4S',
  'P', 'Q', 'K', 'S',
];

/** Extract fields from an ECIA Format 06 barcode string */
export function parseEciaFields(data: string): Map<string, string> {
  const fields = new Map<string, string>();

  // Find the start of actual data after the header
  let content = data;

  // Strip known prefix variations
  if (content.startsWith('[)>')) {
    content = content.slice(3); // after "[)>"
  } else if (content.startsWith('>[)>')) {
    content = content.slice(4); // after ">[)>"
  }

  // Skip past RS06GS header tail if present
  if (content.startsWith(RS + '06' + GS)) {
    content = content.slice((RS + '06' + GS).length);
  } else if (content.startsWith('06' + GS)) {
    content = content.slice(('06' + GS).length);
  }

  // Remove trailing EOT if present
  if (content.endsWith(RS + EOT)) {
    content = content.slice(0, -(RS + EOT).length);
  } else if (content.endsWith(EOT)) {
    content = content.slice(0, -1);
  }

  // Split by Group Separator
  const segments = content.split(GS);

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed.length === 0) {
      continue;
    }

    // Try to match a known DI at the start
    let matchedDi: string | null = null;
    for (const di of KNOWN_DIS) {
      if (trimmed.startsWith(di)) {
        matchedDi = di;
        break;
      }
    }

    if (matchedDi !== null) {
      fields.set(matchedDi, trimmed.slice(matchedDi.length));
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
