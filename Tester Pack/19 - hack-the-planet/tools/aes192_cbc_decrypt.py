#!/usr/bin/env python3
"""
Offline AES-192-CBC decrypt for ZeroDay challenge #19 (hack-the-planet).

The page renders ciphertext + IV per-player. The key is the concatenation
of three GIBSON fragments collected from #7, #13, and #17, each 16 hex
chars (8 bytes), totaling 24 bytes = AES-192.

Usage:
    python3 aes192_cbc_decrypt.py \\
        --ciphertext <hex> \\
        --iv <hex> \\
        --k1 <16-hex> \\
        --k2 <16-hex> \\
        --k3 <16-hex>

Requires the `cryptography` package:
    pip install cryptography
"""

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ciphertext", required=True, help="ciphertext as hex")
    parser.add_argument("--iv", required=True, help="IV as hex (32 hex chars = 16 bytes)")
    parser.add_argument("--k1", required=True, help="GIBSON key fragment 1 (16 hex chars from #7)")
    parser.add_argument("--k2", required=True, help="GIBSON key fragment 2 (16 hex chars from #13)")
    parser.add_argument("--k3", required=True, help="GIBSON key fragment 3 (16 hex chars from #17)")
    args = parser.parse_args()

    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        from cryptography.hazmat.primitives import padding
    except ImportError:
        print(
            "error: this script needs the cryptography package. install:\n"
            "  pip install cryptography",
            file=sys.stderr,
        )
        return 2

    def normalize_hex(s: str, label: str) -> bytes:
        s = "".join(s.split()).lower()
        try:
            return bytes.fromhex(s)
        except ValueError as e:
            print(f"error: {label} is not valid hex: {e}", file=sys.stderr)
            sys.exit(2)

    ct = normalize_hex(args.ciphertext, "--ciphertext")
    iv = normalize_hex(args.iv, "--iv")
    k1 = normalize_hex(args.k1, "--k1")
    k2 = normalize_hex(args.k2, "--k2")
    k3 = normalize_hex(args.k3, "--k3")

    if len(iv) != 16:
        print(f"error: IV must be 16 bytes (32 hex chars), got {len(iv)} bytes.", file=sys.stderr)
        return 2
    for label, frag in (("--k1", k1), ("--k2", k2), ("--k3", k3)):
        if len(frag) != 8:
            print(f"error: {label} must be 8 bytes (16 hex chars), got {len(frag)} bytes.", file=sys.stderr)
            return 2

    key = k1 + k2 + k3
    if len(key) != 24:
        print(f"error: concatenated key is {len(key)} bytes, expected 24 for AES-192.", file=sys.stderr)
        return 2

    cipher = Cipher(algorithms.AES(key), modes.CBC(iv))
    decryptor = cipher.decryptor()
    padded = decryptor.update(ct) + decryptor.finalize()

    # The server uses Node's createCipheriv default: PKCS#7 padding.
    unpadder = padding.PKCS7(128).unpadder()
    try:
        plaintext = unpadder.update(padded) + unpadder.finalize()
    except ValueError as e:
        print(f"error: padding invalid — wrong key or wrong IV: {e}", file=sys.stderr)
        return 2

    try:
        text = plaintext.decode("utf-8")
    except UnicodeDecodeError:
        print("error: decrypted bytes are not valid utf-8 — wrong key.", file=sys.stderr)
        print(f"raw: {plaintext.hex()}", file=sys.stderr)
        return 2

    sys.stdout.write(text)
    if not text.endswith("\n"):
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
