import test from 'node:test';
import assert from 'node:assert/strict';

import {
    cloneItemInfoForAnotherInstance,
    createPlanInstanceRecord,
    getCatalogRecordId,
    getPlanInstancePosition,
    getPlanInstancesForCatalog,
} from '../utils/planInstances.js';

test('groups legacy and duplicated entries by catalog record', () => {
    const records = new Map([
        ['rec-activity', { id: 'rec-activity', fields: { Name: 'Activity' } }],
        ['plan-instance-rec-activity-2', { id: 'plan-instance-rec-activity-2', _catalogRecordId: 'rec-activity', fields: { Name: 'Activity' } }],
    ]);
    const lockedItems = new Map([
        ['rec-activity', { quantity: 1 }],
        ['plan-instance-rec-activity-2', { quantity: 2, catalogRecordId: 'rec-activity' }],
    ]);

    const instances = getPlanInstancesForCatalog(lockedItems, 'rec-activity', id => records.get(id));

    assert.equal(instances.length, 2);
    assert.deepEqual(getPlanInstancePosition(lockedItems, 'plan-instance-rec-activity-2', 'rec-activity', id => records.get(id)), {
        count: 2,
        index: 2,
    });
});

test('copies configuration while clearing instance scheduling and notes', () => {
    const clone = cloneItemInfoForAnotherInstance({
        quantity: 4,
        selections: { group0: 2 },
        note: 'First seating',
        itemDate: '2026-09-10',
        itemStartTime: '6:00 PM',
        itemEndTime: '7:00 PM',
        itemDuration: 60,
    }, 'rec-dinner');

    assert.equal(clone.catalogRecordId, 'rec-dinner');
    assert.equal(clone.quantity, 4);
    assert.deepEqual(clone.selections, { group0: 2 });
    assert.equal(clone.note, '');
    assert.equal(clone.itemDate, undefined);
    assert.equal(clone.itemStartTime, undefined);
    assert.equal(clone.itemEndTime, undefined);
    assert.equal(clone.itemDuration, undefined);
});

test('creates an independently editable record with a catalog reference', () => {
    const source = { id: 'rec-dinner', fields: { Name: 'Dinner', Options: ['A'] } };
    const clone = createPlanInstanceRecord(source, 'plan-instance-rec-dinner-2', 'rec-dinner');

    clone.fields.Name = 'Updated instance';

    assert.equal(clone.id, 'plan-instance-rec-dinner-2');
    assert.equal(clone._planInstance, true);
    assert.equal(getCatalogRecordId(clone.id, null, clone), 'rec-dinner');
    assert.equal(source.fields.Name, 'Dinner');
});
