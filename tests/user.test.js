'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const database = require('../config/database');

function adapter(t, results) {
  const calls = [];
  t.mock.method(database, 'executeQuery', async (sql, params) => {
    calls.push({ sql, params });
    assert.ok(results.length, 'Unexpected SQL query');
    return results.shift();
  });
  delete require.cache[require.resolve('../models/User')];
  return { User: require('../models/User'), calls };
}

test('account authentication trims CHAR padding but does not trim the supplied password', async t => {
  const row = { id: 2, account: 'demo01   ', password: 'Demo!234   ' };
  const { User, calls } = adapter(t, [{ recordset: [row] }, { recordset: [row] }]);
  assert.equal(await User.authenticate('demo01', 'Demo!234'), row);
  assert.equal(await User.authenticate('demo01', ' Demo!234'), null);
  assert.match(calls[0].sql, /@account/);
  assert.deepEqual(calls[0].params, { account: 'demo01' });
});

test('partial profile updates do not clear omitted fields or accept account/role/password changes', async t => {
  const { User, calls } = adapter(t, [{ rowsAffected: [1] }]);
  await User.updateProfile('demo01', { email: 'demo@example.invalid', account: 'admin01', id: 1, password: 'ignored' });
  assert.deepEqual(calls[0].params, { account: 'demo01', email: 'demo@example.invalid' });
  assert.match(calls[0].sql, /SET email=@email,updated_at/);
  assert.doesNotMatch(calls[0].sql, /password=|username=|telephone=/);
  await User.updateProfile('demo01', { id: 1 });
  assert.equal(calls.length, 1);
});

test('password update uses parameters and the old password as a concurrent-update condition', async t => {
  const { User, calls } = adapter(t, [
    { recordset: [{ account: 'demo01', password: 'Demo!234' }] }, { rowsAffected: [1] }
  ]);
  assert.equal(await User.changePassword('demo01', 'Demo!234', "Next'234", '127.0.0.1'), true);
  assert.match(calls[1].sql, /AND password=@oldPassword/);
  assert.ok(!calls[1].sql.includes("Next'234"));
  assert.equal(calls[1].params.newPassword, "Next'234");
});

test('profile exposes only public account fields and occupied character slots', async t => {
  const { User } = adapter(t, [{ recordset: [{ account: 'demo01  ', username: '听雨 ', email: 'demo@example.invalid ',
    char1: '听雨:云端  ', char2: null, char3: ':', char4: 'null', char5: '归舟:云端', lastdate: '2026-10-19' }] }]);
  assert.deepEqual(await User.getProfile('demo01'), { account: 'demo01', username: '听雨', email: 'demo@example.invalid',
    characters: ['听雨:云端', '归舟:云端'], lastdate: '2026-10-19' });
});

test('administrator account query uses bounded stable pagination and literal parameterized search', async t => {
  const { User, calls } = adapter(t, [
    { recordset: [{ total: 22 }] },
    { recordset: [{ id: 2, account: 'demo01  ', char1: '听雨:云端  ', char2: ':', char3: 'null', char4: null,
      char5: '归舟:云端', makedate: '2026-01-01 12:30:00 ', lastdate: '2026-10-30 ', password: 'secret' }] }
  ]);
  const result = await User.listForAdmin({ page: 2, limit: 20, search: "听雨%_[~'" });
  assert.deepEqual(result.records, [{ account: 'demo01', characters: [{ name: '听雨', region: '云端' }, { name: '归舟', region: '云端' }],
    registeredAt: '2026-01-01 12:30:00', lastGameAt: '2026-10-30' }]);
  assert.equal(result.total, 22); assert.equal(result.hasMore, false);
  assert.deepEqual(calls[0].params, { search: "%听雨~%~_~[~~'%" });
  assert.deepEqual(calls[1].params, { search: "%听雨~%~_~[~~'%", offset: 20, limit: 20 });
  assert.match(calls[1].sql, /ROW_NUMBER\(\) OVER \(ORDER BY id DESC\)/);
  assert.match(calls[1].sql, /row_number > @offset AND row_number <= @offset \+ @limit/);
  for (const call of calls) {
    assert.doesNotMatch(call.sql, /SELECT \*|password|masterkey|telephone|听雨/);
    assert.match(call.sql, /char5 LIKE @search ESCAPE '~'/);
  }
});

test('administrator account query handles a page beyond the end', async t => {
  const { User, calls } = adapter(t, [{ recordset: [{ total: 0 }] }, { recordset: [] }]);
  assert.deepEqual(await User.listForAdmin(), { records: [], total: 0, page: 1, limit: 20, pages: 0, hasMore: false });
  assert.deepEqual(calls[0].params, {});
});
