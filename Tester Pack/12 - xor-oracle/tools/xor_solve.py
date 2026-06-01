#!/usr/bin/env python3
"""
Solver for ZeroDay challenge #12 (xor-oracle).

The oracle ships a hex blob. Plaintext always starts with `flag=ZERODAY{`
(13 ASCII chars). The repeating XOR key is shorter than that prefix, so
the head of the ciphertext leaks the full key.

Usage:
    python3 xor_solve.py <HEX_BLOB>
    python3 xor_solve.py < blob.txt
"""

import sys


KNOWN_PREFIX = b"flag=ZERODAY{"  # 13 bytes — longer than the 11-byte key


def recover_key(ct: bytes, known: bytes, max_key_len: int = 12) -> bytes:
    """
    Recover the smallest repeating key consistent with `known` as ct's prefix.
    Returns the shortest period that divides the recovered head consistently.
    """
    head = bytes(c ^ p for c, p in zip(ct[: len(known)], known))
    # Try increasing periods from 1..max; the right key is the smallest one
    # whose repetition reproduces `head`.
    for period in range(1, max_key_len + 1):
        candidate = head[:period]
        if all(head[i] == candidate[i % period] for i in range(len(head))):
            return candidate
    # Fallback: assume the key spans the whole known prefix.
    return head


def xor_decrypt(ct: bytes, key: bytes) -> bytes:
    return bytes(c ^ key[i % len(key)] for i, c in enumerate(ct))


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] not in ("-h", "--help"):
        hex_blob = sys.argv[1]
    else:
        hex_blob = sys.stdin.read()
    hex_blob = "".join(hex_blob.split())  # strip whitespace
    try:
        ct = bytes.fromhex(hex_blob)
    except ValueError as e:
        print(f"error: invalid hex input: {e}", file=sys.stderr)
        return 2

    if len(ct) < len(KNOWN_PREFIX):
        print("error: ciphertext shorter than known prefix.", file=sys.stderr)
        return 2

    key = recover_key(ct, KNOWN_PREFIX)
    pt = xor_decrypt(ct, key)

    print(f"recovered key: {key.decode('latin-1')}")
    print("plaintext:")
    for line in pt.decode("latin-1").splitlines():
        print(f"  {line}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
