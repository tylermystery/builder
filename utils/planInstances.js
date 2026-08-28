export const PLAN_INSTANCE_PREFIX = 'plan-instance-';

export function getCatalogRecordId(recordId, itemInfo = null, record = null) {
    return itemInfo?.catalogRecordId || record?._catalogRecordId || recordId;
}

export function getPlanInstancesForCatalog(lockedItems, catalogRecordId, getRecord = null) {
    if (!lockedItems || !catalogRecordId) return [];

    const instances = [];
    for (const [recordId, itemInfo] of lockedItems.entries()) {
        const record = typeof getRecord === 'function' ? getRecord(recordId) : null;
        if (getCatalogRecordId(recordId, itemInfo, record) === catalogRecordId) {
            instances.push({ recordId, itemInfo, record });
        }
    }
    return instances;
}

export function createPlanInstanceId(catalogRecordId) {
    const randomPart = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `${PLAN_INSTANCE_PREFIX}${catalogRecordId}-${randomPart}`;
}

function cloneSerializable(value) {
    if (value === undefined) return undefined;
    if (globalThis.structuredClone) {
        try {
            return globalThis.structuredClone(value);
        } catch (_) {}
    }
    return JSON.parse(JSON.stringify(value));
}

export function cloneItemInfoForAnotherInstance(itemInfo, catalogRecordId) {
    const clone = cloneSerializable(itemInfo || {}) || {};
    clone.catalogRecordId = catalogRecordId;
    clone.quantity = clone.quantity || 1;
    clone.selectedOptionIndex = clone.selectedOptionIndex || 0;
    clone.selections = clone.selections || {};
    clone.note = '';

    delete clone.itemDate;
    delete clone.itemDateEnd;
    delete clone.itemStartTime;
    delete clone.itemEndTime;
    delete clone.itemDuration;

    return clone;
}

export function createPlanInstanceRecord(sourceRecord, instanceId, catalogRecordId) {
    return {
        ...sourceRecord,
        id: instanceId,
        fields: cloneSerializable(sourceRecord?.fields || {}) || {},
        _planInstance: true,
        _catalogRecordId: catalogRecordId,
    };
}

export function getPlanInstancePosition(lockedItems, recordId, catalogRecordId, getRecord = null) {
    const instances = getPlanInstancesForCatalog(lockedItems, catalogRecordId, getRecord);
    return {
        count: instances.length,
        index: Math.max(0, instances.findIndex(instance => instance.recordId === recordId)) + 1,
    };
}
