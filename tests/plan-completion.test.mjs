import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePlanCompletion } from '../utils/planCompletion.js';

test('items start open and require their own completion plus every linked conversation', () => {
    const itemIds = ['venue', 'food'];
    const completed = new Set();
    const conversations = [
        { type: 'chats', done: false, itemIds: ['venue'] },
        { type: 'tasks', done: false, itemIds: ['venue'] }
    ];
    const read = () => calculatePlanCompletion(itemIds, completed, new Set(), conversations);
    assert.equal(read().status, 'open');
    assert.equal(read().byItem.get('venue').status, 'open');

    completed.add('venue');
    assert.equal(read().percent, 25);
    assert.equal(read().byItem.get('venue').status, 'in-progress');

    conversations[0].done = true;
    conversations[1].done = true;
    assert.equal(read().byItem.get('venue').status, 'complete');
    assert.equal(read().byItem.get('food').status, 'open');
    assert.equal(read().counts.items.done, 1);

    completed.add('food');
    assert.equal(read().status, 'complete');
    assert.equal(read().percent, 100);
    conversations[0].done = false;
    assert.equal(read().percent, 75);
    assert.equal(read().byItem.get('venue').status, 'in-progress');
});

test('standalone work counts equally and a shared task only counts once toward the plan', () => {
    const completion = calculatePlanCompletion(['venue', 'food', 'venue'], new Set(['venue', 'food']), null, [
        { type: 'tasks', done: false, itemIds: ['venue', 'food', 'food'] },
        { type: 'tasks', done: true, itemIds: [] },
        { type: 'chats', done: false, itemIds: [] }
    ]);
    assert.equal(completion.total, 5);
    assert.equal(completion.done, 3);
    assert.equal(completion.percent, 60);
    assert.equal(completion.byItem.get('venue').total, 2);
    assert.equal(completion.byItem.get('food').total, 2);
    assert.deepEqual(completion.counts.tasks, { done: 1, total: 2 });
});

test('empty and archive-only plans are not complete, but standalone chats can complete a plan', () => {
    const itemIds = ['archived-venue'];
    const archived = new Set(itemIds);
    const completed = new Set(['removed-item']);
    const empty = calculatePlanCompletion(itemIds, completed, archived, []);
    assert.equal(empty.status, 'empty');
    assert.equal(empty.byItem.size, 0);

    const chat = { type: 'chats', done: false, itemIds: ['removed-item'] };
    assert.equal(calculatePlanCompletion(itemIds, completed, archived, [chat]).status, 'open');
    chat.done = true;
    assert.equal(calculatePlanCompletion(itemIds, completed, archived, [chat]).status, 'complete');
});
