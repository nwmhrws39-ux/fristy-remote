import { describe, expect, it } from 'vitest';
import {
  DecryptError,
  HandshakeError,
  answerRelayChallenge,
  clientHandshake,
  constantTimeEqualString,
  decodeBase64,
  encodeBase64,
  fingerprint,
  generateKeyPair,
  makeRelayChallenge,
  serverHandshake
} from '../src';

function pair() {
  const server = generateKeyPair();
  const client = generateKeyPair();
  const hs = clientHandshake(client, server.publicKey);
  const srv = serverHandshake(server, hs.hello);
  const clientSession = hs.finish(srv.reply);
  return { server, client, clientSession, serverSession: srv.session, srv };
}

describe('secure channel handshake', () => {
  it('derives matching keys and SAS on both sides', () => {
    const { clientSession, serverSession, client, srv } = pair();
    expect(clientSession.sas).toMatch(/^\d{6}$/);
    expect(clientSession.sas).toBe(serverSession.sas);
    expect(encodeBase64(srv.clientStatic)).toBe(encodeBase64(client.publicKey));
  });

  it('round-trips messages in both directions', () => {
    const { clientSession, serverSession } = pair();
    expect(serverSession.open(clientSession.seal({ hello: 'שלום' }))).toEqual({ hello: 'שלום' });
    expect(clientSession.open(serverSession.seal([1, 2, 3]))).toEqual([1, 2, 3]);
    expect(serverSession.open(clientSession.seal({ n: 2 }))).toEqual({ n: 2 });
  });

  it('rejects replayed frames', () => {
    const { clientSession, serverSession } = pair();
    const frame = clientSession.seal({ action: 'shutdown' });
    serverSession.open(frame);
    expect(() => serverSession.open(frame)).toThrow(DecryptError);
  });

  it('rejects reordered frames', () => {
    const { clientSession, serverSession } = pair();
    const a = clientSession.seal(1);
    const b = clientSession.seal(2);
    expect(() => serverSession.open(b)).toThrow(DecryptError);
    void a;
  });

  it('rejects tampered ciphertext', () => {
    const { clientSession, serverSession } = pair();
    const frame = JSON.parse(clientSession.seal({ x: 1 }));
    const bytes = decodeBase64(frame.c);
    bytes[bytes.length - 1]! ^= 1;
    expect(() => serverSession.open(JSON.stringify({ t: 'e', c: encodeBase64(bytes) }))).toThrow(DecryptError);
  });

  it('client refuses a server that is not the pinned computer', () => {
    const real = generateKeyPair();
    const impostor = generateKeyPair();
    const client = generateKeyPair();
    const hs = clientHandshake(client, real.publicKey);
    const srv = serverHandshake(impostor, hs.hello);
    expect(() => hs.finish(srv.reply)).toThrow(HandshakeError);
  });

  it('an impostor server that replays the real public key cannot decrypt client traffic', () => {
    const real = generateKeyPair();
    const impostor = generateKeyPair();
    const client = generateKeyPair();
    const hs = clientHandshake(client, real.publicKey);
    const srv = serverHandshake(impostor, hs.hello);
    const forged = JSON.stringify({ ...JSON.parse(srv.reply), ss: encodeBase64(real.publicKey) });
    const clientSession = hs.finish(forged);
    expect(() => srv.session.open(clientSession.seal({ kind: 'auth' }))).toThrow(DecryptError);
  });

  it('a client that does not hold the identity secret cannot talk to the server', () => {
    const server = generateKeyPair();
    const victim = generateKeyPair();
    const attacker = generateKeyPair();
    const hs = clientHandshake(attacker, server.publicKey);
    // attacker claims victim's public key in the hello
    const forgedHello = JSON.stringify({ ...JSON.parse(hs.hello), cs: encodeBase64(victim.publicKey) });
    const srv = serverHandshake(server, forgedHello);
    const attackerSession = hs.finish(srv.reply);
    expect(() => srv.session.open(attackerSession.seal({ kind: 'auth' }))).toThrow(DecryptError);
  });

  it('rejects malformed hellos and low-order keys', () => {
    const server = generateKeyPair();
    expect(() => serverHandshake(server, 'nope')).toThrow(HandshakeError);
    const zero = encodeBase64(new Uint8Array(32));
    expect(() => serverHandshake(server, JSON.stringify({ t: 'hello', v: 1, cs: zero, ce: zero }))).toThrow(HandshakeError);
  });
});

describe('relay challenge', () => {
  it('only the key holder can answer', () => {
    const host = generateKeyPair();
    const other = generateKeyPair();
    const { challenge, frame } = makeRelayChallenge(host.publicKey);
    expect(answerRelayChallenge(host, frame)).toBe(encodeBase64(challenge));
    expect(answerRelayChallenge(other, frame)).toBeNull();
  });
});

describe('helpers', () => {
  it('fingerprints and compares', () => {
    const k = generateKeyPair();
    expect(fingerprint(k.publicKey)).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(constantTimeEqualString('abc', 'abc')).toBe(true);
    expect(constantTimeEqualString('abc', 'abd')).toBe(false);
    expect(constantTimeEqualString('abc', 'abcd')).toBe(false);
  });
});
