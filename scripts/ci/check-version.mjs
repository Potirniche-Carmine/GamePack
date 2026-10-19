import assert from 'node:assert/strict';
import {checkVersion} from '../release/version.mjs';

const version = checkVersion();
if (process.env.RELEASE_TAG) assert.equal(process.env.RELEASE_TAG, `v${version}`, 'release tag version');
console.log(`All package versions match ${version}.`);
