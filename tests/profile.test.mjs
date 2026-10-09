import test from 'node:test';
import assert from 'node:assert/strict';
import {initialsForName} from '../packages/app/src/profile.ts';

test('avatars use the first and last names without splitting compound or middle names', () => {
  assert.equal(initialsForName('  Carmine   Pugliese  '), 'CP');
  assert.equal(initialsForName('Mary Jane Watson'), 'MW');
  assert.equal(initialsForName('Jean-Luc Picard'), 'JP');
  assert.equal(initialsForName('Prince'), 'P');
  assert.equal(initialsForName(''), '–');
  assert.equal(initialsForName('   '), '–');
});

test('avatars preserve Unicode names and avoid broken surrogate or combining characters', () => {
  assert.equal(initialsForName('éloïse d’Arc'), 'ÉD');
  assert.equal(initialsForName('e\u0301loïse d’Arc'), 'ÉD');
  assert.equal(initialsForName('李 小龍'), '李小');
  assert.equal(initialsForName('𐐨lex Smith'), '𐐀S');
  assert.equal(initialsForName('“Alex” Smith'), 'AS');
  assert.equal(initialsForName('...'), '–');
});
