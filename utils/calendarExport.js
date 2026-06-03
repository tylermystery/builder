/**
 * Calendar Export Utilities
 * Provides functions to export events to various calendar formats
 */

/**
 * Parse a time string to hours and minutes.
 * Tolerant of the various shapes stored in Airtable: "7:00 PM", "14:30",
 * "11 am", "11am", and ranges like "5 - 8 pm" / "11am - 9pm" (the first time
 * is used, inheriting a trailing AM/PM from later in the range when needed).
 * @param {string} timeStr - Time string
 * @returns {Object|null} Object with hours and minutes, or null if invalid
 */
function parseTime(timeStr) {
  if (!timeStr) return null;

  // Collect every time token in order (digits, optional :minutes, optional am/pm)
  const tokenRe = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
  const tokens = [];
  let m;
  while ((m = tokenRe.exec(timeStr)) !== null) {
    tokens.push({
      hours: parseInt(m[1], 10),
      minutes: m[2] ? parseInt(m[2], 10) : 0,
      meridiem: m[3] ? m[3].toUpperCase() : null
    });
  }
  if (tokens.length === 0) return null;

  const first = tokens[0];
  // A start time without AM/PM (e.g. the "5" in "5 - 8 pm") inherits it from
  // a later token in the range.
  if (!first.meridiem) {
    const withMeridiem = tokens.find(t => t.meridiem);
    if (withMeridiem) first.meridiem = withMeridiem.meridiem;
  }

  let hours = first.hours;
  if (first.meridiem === 'PM' && hours !== 12) {
    hours += 12;
  } else if (first.meridiem === 'AM' && hours === 12) {
    hours = 0;
  }

  if (hours < 0 || hours > 23 || first.minutes < 0 || first.minutes > 59) return null;
  return { hours, minutes: first.minutes };
}

/**
 * Resolve an event's start and end Date objects from its Airtable fields.
 *
 * The published plan syncs clean machine-readable values onto the event record:
 *   - Start_time : the plan start time (e.g. "7:00 PM")
 *   - Duration   : the plan duration in hours (e.g. "2")
 *   - End_time   : the computed end time (e.g. "9:00 PM")
 *   - Time       : a human-readable range used for display
 *
 * Priority: Start_time (falling back to Time) for the start; Duration (falling
 * back to End_time, then a sensible default) for the length. The legacy
 * "Duration (hours)" field is still honored if present.
 *
 * @param {Object} fields - Event record fields (must include Date)
 * @returns {{ startDate: Date, endDate: Date }}
 */
function resolveEventSchedule(fields) {
  const date = fields.Date;
  const startStr = fields.Start_time || fields.Time;
  const startParts = parseTime(startStr);

  // Build start date in local timezone to avoid date shifting
  const startDate = new Date(date + 'T00:00:00');
  if (startParts) {
    startDate.setHours(startParts.hours, startParts.minutes, 0, 0);
  } else {
    // Default to 11:00 AM when no start time is known
    startDate.setHours(11, 0, 0, 0);
  }

  // Duration in hours — prefer the real "Duration" field, fall back to legacy "Duration (hours)"
  const rawDuration = (fields.Duration != null && fields.Duration !== '')
    ? fields.Duration
    : fields['Duration (hours)'];
  const durationHours = (rawDuration != null && rawDuration !== '') ? parseFloat(rawDuration) : NaN;

  let endDate;
  if (!isNaN(durationHours) && durationHours > 0) {
    endDate = new Date(startDate.getTime() + durationHours * 60 * 60 * 1000);
  } else {
    const endParts = parseTime(fields.End_time);
    if (endParts) {
      endDate = new Date(startDate);
      endDate.setHours(endParts.hours, endParts.minutes, 0, 0);
      // End earlier than start means the event crosses midnight
      if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);
    } else {
      // No duration or end time: 2h when a start time is known, otherwise an all-day-feel 8h
      const fallbackHours = startParts ? 2 : 8;
      endDate = new Date(startDate.getTime() + fallbackHours * 60 * 60 * 1000);
    }
  }

  return { startDate, endDate };
}

/**
 * Resolve the shareable "WTF link" for an event — the link back to the plan's
 * presentation view, where calendar invitees can view the plan and RSVP.
 *
 * Built from the event's LinkedSession (the session the published plan lives in).
 * Uses the current site origin in the browser, falling back to the production
 * URL when no window is available. Returns '' when the event has no linked
 * session (e.g. a catalog item that was never published from a plan).
 *
 * @param {Object} fields - Event record fields
 * @returns {string} Absolute WTF link, or '' if unavailable
 */
function resolveWtfLink(fields) {
  const sessionId = Array.isArray(fields.LinkedSession) ? fields.LinkedSession[0] : null;
  if (!sessionId) return '';
  const origin = (typeof window !== 'undefined' && window.location && window.location.origin)
    ? window.location.origin
    : 'https://whatthefunfinder.netlify.app';
  return `${origin}/?session=${sessionId}&view=present`;
}

/**
 * Append the WTF link to an event description so it travels into the calendar
 * entry's notes. No-op when there is no link.
 * @param {string} description - Raw event description
 * @param {string} wtfLink - Resolved WTF link (may be '')
 * @returns {string} Description with the link appended
 */
function appendWtfLink(description, wtfLink) {
  const desc = description || '';
  if (!wtfLink) return desc;
  return desc ? `${desc}\n\nView & RSVP: ${wtfLink}` : `View & RSVP: ${wtfLink}`;
}

/**
 * Format a Date object as a UTC iCal timestamp (YYYYMMDDTHHMMSSZ).
 * Unlike formatICalDate, this preserves the Date's existing time of day.
 * @param {Date} dateObj - Date to format
 * @returns {string} Formatted iCal date string
 */
function formatICalDateUTC(dateObj) {
  const year = dateObj.getUTCFullYear();
  const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getUTCDate()).padStart(2, '0');
  const hours = String(dateObj.getUTCHours()).padStart(2, '0');
  const minutes = String(dateObj.getUTCMinutes()).padStart(2, '0');
  const seconds = String(dateObj.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Escape special characters for iCal format
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeICalText(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/**
 * Generate iCal file content
 * @param {Object} event - Event record from Airtable
 * @returns {string} iCal file content
 */
function generateICalFile(event) {
  const fields = event.fields || event;

  const title = escapeICalText(fields.Name || 'Event');
  // Include the shareable WTF link in the notes so invitees can view the plan and RSVP
  const wtfLink = resolveWtfLink(fields);
  const description = escapeICalText(appendWtfLink(fields.Description || '', wtfLink));
  const location = escapeICalText(fields['Location Details'] || '');

  // Resolve start/end from the plan-synced schedule fields (Start_time / Duration / End_time)
  const { startDate, endDate } = resolveEventSchedule(fields);

  // Format dates for iCal (UTC, preserving the resolved time of day)
  const dtStart = formatICalDateUTC(startDate);
  const dtEnd = formatICalDateUTC(endDate);
  const dtStamp = formatICalDateUTC(new Date());

  // Generate unique ID
  const uid = `${event.id || Date.now()}@whatthefun.com`;

  // Build iCal content
  const icalLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//What The Fun//Event Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`
  ];
  // Standard URL property so calendar clients that surface it link back to the plan
  if (wtfLink) {
    icalLines.push(`URL:${wtfLink}`);
  }
  icalLines.push('STATUS:CONFIRMED', 'SEQUENCE:0', 'END:VEVENT', 'END:VCALENDAR');

  return icalLines.join('\r\n');
}

/**
 * Download iCal file
 * @param {Object} event - Event record from Airtable
 */
function downloadICalFile(event) {
  const icalContent = generateICalFile(event);
  const blob = new Blob([icalContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${(event.fields?.Name || 'event').replace(/[^a-z0-9]/gi, '_')}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the URL object
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Generate Google Calendar URL
 * @param {Object} event - Event record from Airtable
 * @returns {string} Google Calendar URL
 */
function generateGoogleCalendarUrl(event) {
  const fields = event.fields || event;

  const title = encodeURIComponent(fields.Name || 'Event');
  const description = encodeURIComponent(appendWtfLink(fields.Description || '', resolveWtfLink(fields)));
  const location = encodeURIComponent(fields['Location Details'] || '');

  // Resolve start/end from the plan-synced schedule fields (Start_time / Duration / End_time)
  const { startDate, endDate } = resolveEventSchedule(fields);

  // Format dates for Google Calendar (YYYYMMDDTHHmmss)
  const formatGoogleDate = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}`;
  };

  const dates = `${formatGoogleDate(startDate)}/${formatGoogleDate(endDate)}`;

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${description}&location=${location}`;
}

/**
 * Generate Outlook Calendar URL
 * @param {Object} event - Event record from Airtable
 * @returns {string} Outlook Calendar URL
 */
function generateOutlookCalendarUrl(event) {
  const fields = event.fields || event;

  const title = encodeURIComponent(fields.Name || 'Event');
  const description = encodeURIComponent(appendWtfLink(fields.Description || '', resolveWtfLink(fields)));
  const location = encodeURIComponent(fields['Location Details'] || '');

  // Resolve start/end from the plan-synced schedule fields (Start_time / Duration / End_time)
  const { startDate, endDate } = resolveEventSchedule(fields);

  // Format dates for Outlook (ISO 8601)
  const startTime = startDate.toISOString();
  const endTime = endDate.toISOString();

  return `https://outlook.live.com/calendar/0/deeplink/compose?subject=${title}&body=${description}&location=${location}&startdt=${startTime}&enddt=${endTime}&path=/calendar/action/compose&rru=addevent`;
}

/**
 * Generate Yahoo Calendar URL
 * @param {Object} event - Event record from Airtable
 * @returns {string} Yahoo Calendar URL
 */
function generateYahooCalendarUrl(event) {
  const fields = event.fields || event;

  const title = encodeURIComponent(fields.Name || 'Event');
  const description = encodeURIComponent(appendWtfLink(fields.Description || '', resolveWtfLink(fields)));
  const location = encodeURIComponent(fields['Location Details'] || '');

  // Resolve start/end from the plan-synced schedule fields (Start_time / Duration / End_time)
  const { startDate, endDate } = resolveEventSchedule(fields);

  // Format dates for Yahoo (YYYYMMDDTHHmmss)
  const formatYahooDate = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  };

  const st = formatYahooDate(startDate);
  const et = formatYahooDate(endDate);

  // Calculate duration for Yahoo (in hours and minutes)
  const durationMinutes = Math.round((endDate - startDate) / 1000 / 60);
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  const dur = `${String(hours).padStart(2, '0')}${String(minutes).padStart(2, '0')}`;

  return `https://calendar.yahoo.com/?v=60&title=${title}&st=${st}&dur=${dur}&desc=${description}&in_loc=${location}`;
}

/**
 * Open calendar export in new window/tab
 * @param {string} url - Calendar URL
 */
function openCalendarUrl(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Create calendar export buttons HTML
 * @param {Object} event - Event record from Airtable
 * @returns {string} HTML for calendar export buttons
 */
function createCalendarExportButtons(event) {
  // Only show for events with dates
  if (!event.fields?.Date) {
    return '';
  }

  return `
    <div class="calendar-export-container">
      <div class="calendar-export-label">Add to Calendar:</div>
      <div class="calendar-export-buttons">
        <button class="calendar-export-btn google-calendar-btn" data-calendar="google" title="Add to Google Calendar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/>
          </svg>
          Google
        </button>
        <button class="calendar-export-btn outlook-calendar-btn" data-calendar="outlook" title="Add to Outlook Calendar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
          </svg>
          Outlook
        </button>
        <button class="calendar-export-btn apple-calendar-btn" data-calendar="apple" title="Add to Apple Calendar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
          </svg>
          Apple
        </button>
        <button class="calendar-export-btn yahoo-calendar-btn" data-calendar="yahoo" title="Add to Yahoo Calendar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 4H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H5V8l7 4.5L19 8v10z"/>
          </svg>
          Yahoo
        </button>
        <button class="calendar-export-btn ical-download-btn" data-calendar="ical" title="Download iCal file">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7h14v2H5z"/>
          </svg>
          Download
        </button>
      </div>
    </div>
  `;
}

/**
 * Initialize calendar export event listeners
 * @param {Object} event - Event record from Airtable
 * @param {HTMLElement} container - Container element with calendar buttons
 */
function initializeCalendarExportListeners(event, container) {
  if (!container) return;

  const buttons = container.querySelectorAll('.calendar-export-btn');

  buttons.forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const calendarType = button.getAttribute('data-calendar');

      switch (calendarType) {
        case 'google':
          openCalendarUrl(generateGoogleCalendarUrl(event));
          break;
        case 'outlook':
          openCalendarUrl(generateOutlookCalendarUrl(event));
          break;
        case 'apple':
          // Apple Calendar uses iCal files
          downloadICalFile(event);
          break;
        case 'yahoo':
          openCalendarUrl(generateYahooCalendarUrl(event));
          break;
        case 'ical':
          downloadICalFile(event);
          break;
      }
    });
  });
}

// ES6 Module Exports (for import statements)
export {
  generateICalFile,
  downloadICalFile,
  generateGoogleCalendarUrl,
  generateOutlookCalendarUrl,
  generateYahooCalendarUrl,
  openCalendarUrl,
  createCalendarExportButtons,
  initializeCalendarExportListeners
};

// CommonJS Export (for Node.js compatibility)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateICalFile,
    downloadICalFile,
    generateGoogleCalendarUrl,
    generateOutlookCalendarUrl,
    generateYahooCalendarUrl,
    openCalendarUrl,
    createCalendarExportButtons,
    initializeCalendarExportListeners
  };
}

// Make available globally for browser use
if (typeof window !== 'undefined') {
  window.calendarExport = {
    generateICalFile,
    downloadICalFile,
    generateGoogleCalendarUrl,
    generateOutlookCalendarUrl,
    generateYahooCalendarUrl,
    openCalendarUrl,
    createCalendarExportButtons,
    initializeCalendarExportListeners
  };
}
