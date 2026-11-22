import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS, point, summarize, toJson, toText } from '../src/silka/doctor/result.mjs';

test('DR-F1 el formato de un punto es estable: mismos campos, mismo orden', () => {
  const p = point({ id: 'node', name: 'Node', status: STATUS.OK });
  assert.deepEqual(Object.keys(p), ['id', 'name', 'status', 'cause', 'fix']);
  assert.deepEqual(p, { id: 'node', name: 'Node', status: 'ok', cause: '', fix: '' });
});

test('DR-F2 un estado desconocido o un punto sin id se rechazan', () => {
  assert.throws(() => point({ id: 'x', name: 'X', status: 'quizá' }), /estado no válido/);
  assert.throws(() => point({ id: '', name: 'X', status: STATUS.OK }), /id y nombre/);
});

test('DR-F3 el código de salida solo es distinto de cero con una falla; los avisos no cuentan', () => {
  const ok = point({ id: 'a', name: 'A', status: STATUS.OK });
  const warn = point({ id: 'b', name: 'B', status: STATUS.WARN, cause: 'c', fix: 'f' });
  const fail = point({ id: 'c', name: 'C', status: STATUS.FAIL, cause: 'c', fix: 'f' });
  assert.equal(summarize([ok, warn]).exitCode, 0);
  assert.equal(summarize([ok, warn, fail]).exitCode, 1);
  assert.equal(summarize([ok, warn, fail]).failed, 1);
});

test('DR-F4 el JSON es válido y lleva los puntos con estado, causa y arreglo', () => {
  const fail = point({ id: 'hubs', name: 'Hubs', status: STATUS.FAIL, cause: 'dos hubs', fix: 'deja uno' });
  const parsed = JSON.parse(toJson([fail]));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.failed, 1);
  assert.deepEqual(parsed.points, [{ id: 'hubs', name: 'Hubs', status: 'falla', cause: 'dos hubs', fix: 'deja uno' }]);
});

test('DR-F5 el texto muestra causa y arreglo solo cuando algo no está bien', () => {
  const text = toText([
    point({ id: 'node', name: 'Node', status: STATUS.OK }),
    point({ id: 'hubs', name: 'Hubs', status: STATUS.FAIL, cause: 'dos hubs', fix: 'deja uno' }),
  ]);
  assert.match(text, /OK +Node/);
  assert.match(text, /causa: dos hubs/);
  assert.match(text, /arreglo: deja uno/);
  assert.match(text, /1 falla/);
});
