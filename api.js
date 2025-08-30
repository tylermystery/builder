/*
 * Version: 2.8.0
 * Last Modified: 2025-08-30
 *
 * Changelog:
 *
 * v2.8.0 - 2025-08-30
 * - Fixed Airtable 422 Error by only including the Date field in the payload when it has a value.
 *
 * v2.7.9 - 2025-08-29
 * - Removed incorrect date validation in saveSessionToAirtable to allow full ISO date strings.
 */
import { state } from './state.js'; [cite: 473]
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from './config.js'; [cite: 473]
import { storeSession } from './session.js'; [cite: 473]
import { parseOptions } from './utils.js'; [cite: 474]
const PERSONAL_ACCESS_TOKEN = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57'; [cite: 474]
const BASE_ID = 'app5yTznb3R5YNUFw'; [cite: 474]
const TABLE_ID = 'tblUA4uuS8IYlhKpD'; [cite: 474]
const SESSIONS_TABLE_NAME = 'Sessions'; [cite: 475]

export async function loadSessionFromAirtable(sessionId) {
    state.session.id = sessionId; [cite: 475]
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`; [cite: 475]
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } }); [cite: 476]
        if (!response.ok) throw new Error('Could not fetch session data.'); [cite: 477]
        const record = await response.json(); [cite: 477]
        
        state.session.isOwned = false; [cite: 477]
        state.session.collaborators = record.fields.Collaborators ? record.fields.Collaborators.split(',').map(name => name.trim()) : []; [cite: 478]
        const sessionDataString = record.fields['Items with Variations']; [cite: 478]
        if (sessionDataString) {
            const savedState = JSON.parse(sessionDataString); [cite: 479]
            if (savedState.favoritedItems) state.cart.items = new Map(Object.entries(savedState.favoritedItems)); [cite: 480]
            if (savedState.lockedInItems) state.cart.lockedItems = new Map(Object.entries(savedState.lockedInItems)); [cite: 480]
            if (savedState.itemReactions) state.session.reactions = new Map(Object.entries(savedState.itemReactions)); [cite: 480]
            if (savedState.favoritedDetails) state.eventDetails.combined = new Map(Object.entries(savedState.favoritedDetails)); [cite: 481]
        }
    } catch (error) {
        console.error("Failed to load session:", error); [cite: 481]
        alert("Could not load the shared session."); [cite: 482]
        window.history.replaceState({}, document.title, window.location.pathname); [cite: 482]
    }
}

export async function saveSessionToAirtable() {
    if (state.session.id && !state.session.isOwned) {
        state.session.id = null; [cite: 482]
    }

    const sessionData = { favoritedItems: Object.fromEntries(state.cart.items), lockedInItems: Object.fromEntries(state.cart.lockedItems), itemReactions: Object.fromEntries(state.session.reactions), favoritedDetails: Object.fromEntries(state.eventDetails.combined) }; [cite: 483]
    const sessionName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || `Session from ${new Date().toLocaleString()}`; [cite: 484]

    const dateRange = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE); [cite: 484]
    let formattedDate = null; [cite: 484]
    if (Array.isArray(dateRange) && dateRange.length > 0) {
        const startDateString = dateRange[0]; [cite: 485]
        if (startDateString) {
            formattedDate = new Date(startDateString).toISOString(); [cite: 486]
        }
    }

    const fields = {
        "Name": sessionName,
        "Items with Variations": JSON.stringify(sessionData),
        "Collaborators": state.session.collaborators.join(', '),
        "Guest Count": parseInt(state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT), 10) || null, [cite: 488, 489]
        "Goals": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || null, [cite: 489, 490]
    };

    if (formattedDate) {
        fields["Date"] = formattedDate;
    }

    const payload = { fields }; [cite: 490]
    const isUpdate = state.session.id !== null; [cite: 491]
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}` + (isUpdate ? `/${state.session.id}` : ''); [cite: 491]
    const method = isUpdate ? 'PATCH' : 'POST'; [cite: 492]

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(isUpdate ? payload : { records: [payload] })
        }); [cite: 492]
        if (!response.ok) {
            const errorData = await response.json(); [cite: 493]
            throw new Error(`Airtable API Error: ${errorData.error.message}`); [cite: 494]
        }
        const result = await response.json(); [cite: 494]
        if (!isUpdate) {
            state.session.id = result.records[0].id; [cite: 495]
            state.session.isOwned = true; [cite: 495]
            window.history.replaceState({}, document.title, `?session=${state.session.id}`); [cite: 496]
        }
        
        storeSession(state.session.id, sessionName); [cite: 496]
        return true; [cite: 497]
    } catch (error) {
        console.error("Failed to save session:", error); [cite: 497]
        return false; [cite: 498]
    }
}

export async function fetchAllRecords() {
    let records = []; [cite: 498]
    let offset = null; [cite: 498]
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?`; [cite: 498]
    try {
        do {
            const response = await fetch(offset ? `${url}&offset=${offset}` : url, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } }); [cite: 499]
            if (!response.ok) throw new Error('Failed to fetch data from Airtable.'); [cite: 500]
            const data = await response.json(); [cite: 500]
            records = records.concat(data.records); [cite: 500]
            offset = data.offset; [cite: 501]
        } while (offset);
        return records.filter(record => record.fields); [cite: 501]
    } catch (error) {
        console.error(error); [cite: 502]
        throw error; [cite: 503]
    }
}

export async function fetchCalendarForRecord(record) {
    const icalUrl = record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL]; [cite: 503]
    if (!icalUrl) {
        return []; [cite: 504]
    }
    if (state.calendar.busyTimes.has(icalUrl)) {
        return state.calendar.busyTimes.get(icalUrl); [cite: 505]
    }
    try {
        const proxyUrl = `/api/calendar?url=${encodeURIComponent(icalUrl)}`; [cite: 506]
        const response = await fetch(proxyUrl); [cite: 507]
        if (!response.ok) {
            throw new Error(`Calendar API Error: ${response.statusText}`); [cite: 507]
        }
        const busyTimes = await response.json(); [cite: 508]
        state.calendar.busyTimes.set(icalUrl, busyTimes); [cite: 508]
        return busyTimes; [cite: 508]
    } catch (error) {
        console.error(`Failed to fetch calendar for ${record.fields.Name}:`, error); [cite: 509]
        state.calendar.busyTimes.set(icalUrl, []); [cite: 509]
        return []; [cite: 510]
    }
}

export async function fetchImagesByTags(tags, retries = 2) {
    if (!tags || tags.length === 0) return null; [cite: 510]
    try {
        let payload; [cite: 511]
        if (Array.isArray(tags)) {
            payload = { expression: tags.map(tag => `tags:"${tag}"`).join(' AND ') }; [cite: 512]
        } else {
            payload = { tag: tags }; [cite: 513]
        }
        
        const response = await fetch('/.netlify/functions/cloudinary', {
            method: 'POST',
            body: JSON.stringify(payload)
        }); [cite: 514]
        if (response.status === 420 && retries > 0) {
            console.warn(`Cloudinary rate limit hit. Retrying in 250ms... (${retries} retries left)`); [cite: 515]
            await new Promise(res => setTimeout(res, 250)); [cite: 516]
            return fetchImagesByTags(tags, retries - 1); [cite: 516]
        }

        if (!response.ok) {
            console.warn(`Cloudinary function error: ${response.statusText}`); [cite: 517]
            return null; [cite: 518]
        }
        
        const data = await response.json(); [cite: 518]
        if (!data.resources || data.resources.length === 0) return null; [cite: 519]
        
        return data.resources.map(image => {
            let transformations; [cite: 519]
            if (image.format === 'gif') {
                transformations = 'c_fit,w_600,h_520'; [cite: 519]
            } else {
                transformations = 'c_fill,g_auto,w_600,h_520'; [cite: 519]
            }
            const urlParts = image.secure_url.split('/upload/'); [cite: 520]
            return `${urlParts[0]}/upload/${transformations}/${urlParts[1]}`; [cite: 520]
        });
    } catch (error) {
        console.error('Failed to fetch from Cloudinary via proxy:', error); [cite: 521]
        return null; [cite: 522]
    }
}

export async function fetchImagesForRecord(record, allRecords, imageCache) {
    const cacheKey = record.id; [cite: 522]
    if (imageCache.has(cacheKey)) {
        return imageCache.get(cacheKey); [cite: 523]
    }

    const defaultImagePublicID = 'ww71meppejsewxsxr4x7.jpg'; [cite: 523]
    const ultimateFallbackUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/${defaultImagePublicID}`; [cite: 524]
    
    let imageUrls = null; [cite: 524]
    
    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]); [cite: 524]
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name)); [cite: 524]
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name)); [cite: 525]

    if (isGrouping) {
        const groupNameTag = record.fields[CONSTANTS.FIELD_NAMES.NAME].toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''); [cite: 525]
        imageUrls = await fetchImagesByTags(groupNameTag); [cite: 526]
        if (!imageUrls || imageUrls.length === 0) {
            const firstChildOption = rawOptions.length > 0 ? rawOptions[0] : null; [cite: 526, 527]
            if (firstChildOption) {
                const firstChildRecord = allRecords.find(r => r.fields.Name === firstChildOption.name); [cite: 527]
                if (firstChildRecord) {
                    const childImageData = await fetchImagesForRecord(firstChildRecord, allRecords, imageCache); [cite: 528]
                    imageUrls = childImageData.imageUrls; [cite: 529]
                }
            }
        }
    } else {
        const itemName = record.fields[CONSTANTS.FIELD_NAMES.NAME]; [cite: 529]
        if (itemName) {
            const autoTagName = itemName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''); [cite: 530]
            imageUrls = await fetchImagesByTags(autoTagName); [cite: 531]
        }
        
        if (!imageUrls) {
            const manualTags = record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS]; [cite: 531]
            const primaryManualTag = (manualTags && manualTags.trim() !== '') ? manualTags.split(',').shift().trim() : null; [cite: 532]
            if (primaryManualTag) {
                imageUrls = await fetchImagesByTags(primaryManualTag); [cite: 533]
            }
        }
    }
    
    const finalImageUrls = (imageUrls && imageUrls.length > 0) ? imageUrls : [ultimateFallbackUrl]; [cite: 534, 535]
    
    const result = {
        isGrouping: isGrouping,
        imageUrls: finalImageUrls.flat()
    }; [cite: 535]
    imageCache.set(cacheKey, result); [cite: 536]
    return result; [cite: 536]
}
