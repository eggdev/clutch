import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  DeviceHostError,
  agentDeviceOf,
  deviceHost,
  deviceName,
  install,
  installedOn,
  poolHost,
  recordInstalled,
  runFlow,
} from '@tools/native/device-host';

const bound = '/tmp/t3/devices/lease-1/agent-device';

/** A pool host on a fake bound command that answers `output` with `exitCode`, and keeps each call. */
function fakePool(output = 'ok', exitCode = 0) {
  const calls: Array<string> = [];
  const host = poolHost({
    env: { AGENT_DEVICE: bound },
    exists: (file) => file === bound,
    run: (command, args) => {
      calls.push([command, ...args].join(' '));
      return { exitCode, output };
    },
  });
  return { calls, host };
}

test('with no AGENT_DEVICE, each device call refuses and names the device tools', () => {
  const host = poolHost({ env: {}, run: () => ({ exitCode: 0, output: '' }) });
  expect(() => runFlow(host, 'a.yaml')).toThrow(DeviceHostError);
  expect(() => install(host, 'App.app')).toThrow('`AGENT_DEVICE` is not set');
  for (const part of ['device_list', 'device_open', 'AGENT_DEVICE=<path>', '#the-device-pool']) {
    expect(() => agentDeviceOf({})).toThrow(part);
  }
});

test('an AGENT_DEVICE path that does not exist is refused, since its device closed', () => {
  expect(() => agentDeviceOf({ AGENT_DEVICE: '/gone/agent-device' }, () => false)).toThrow(
    '`AGENT_DEVICE` names /gone/agent-device, which does not exist. The command goes away when its device closes.',
  );
});

test('install and runFlow call the bound command with install and replay --maestro', () => {
  const { calls, host } = fakePool();
  install(host, '/builds/App.app');
  expect(runFlow(host, 'sign-up.maestro.yaml')).toEqual({ exitCode: 0, output: 'ok' });
  expect(calls).toEqual([
    `${bound} install /builds/App.app`,
    `${bound} replay sign-up.maestro.yaml --maestro --timeout 900000`,
  ]);
  expect(() => install(fakePool('not an app bundle', 1).host, 'x.app')).toThrow('not an app');
});

test('deviceName reads the model of the opened device, and falls back when it cannot', () => {
  const listed = JSON.stringify({ success: true, data: { devices: [{ model: 'iPhone 17' }] } });
  const { calls, host } = fakePool(listed);
  expect(deviceName(host)).toBe('iPhone 17');
  expect(calls).toEqual([`${bound} devices --json`]);
  expect(deviceName(fakePool('not json').host)).toBe('the opened device');
  expect(deviceName(fakePool(listed, 1).host)).toBe('the opened device');
});

test('the pool host is the device host of the template, and its id is the bound command', () => {
  expect(deviceHost({}).name).toBe('pool');
  expect(fakePool().host.id()).toBe(bound);
  expect(() => poolHost({ env: {} }).id()).toThrow('`AGENT_DEVICE` is not set');
});

test('installedOn reads what recordInstalled wrote, and nothing for another device', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'device-record-'));
  const { host } = fakePool();
  const other = poolHost({ env: { AGENT_DEVICE: '/lease-2/agent-device' }, exists: () => true });
  expect(installedOn(root, host)).toBeNull();
  recordInstalled(root, host, 'a1b2');
  expect(installedOn(root, host)).toEqual({ fingerprint: 'a1b2' });
  expect(installedOn(root, other)).toBeNull();
});
