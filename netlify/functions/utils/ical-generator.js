function formatICalDate(dateStr, timeStr) {
    // Parse date in local timezone to avoid timezone conversion issues
    const date = new Date(dateStr + 'T00:00:00');

    if (timeStr) {
        const [hours, minutes] = timeStr.split(':');
        date.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
    } else {
        // Default to 11:00 AM if no time is provided
        date.setHours(11, 0, 0, 0);
    }

    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function generateICalContent(event) {
    const { Name, Date: eventDate, Time: eventTime, Description, Location } = event.fields;
    
    if (!eventDate) {
        throw new Error('Event date is required for iCal generation');
    }
    
    const startDate = formatICalDate(eventDate, eventTime);

    // Parse date in local timezone
    const endDate = new Date(eventDate + 'T00:00:00');
    if (eventTime) {
        const [hours, minutes] = eventTime.split(':');
        endDate.setHours(parseInt(hours, 10) + 2, parseInt(minutes, 10), 0, 0);
    } else {
        // Default end time: 11 AM + 8 hours = 7 PM
        endDate.setHours(19, 0, 0, 0);
    }
    const formattedEndDate = endDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    
    const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const uid = `${event.id}@whatthefunfinder.com`;
    
    const escapedName = (Name || 'Event').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const escapedDescription = (Description || '').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const escapedLocation = (Location || '').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    
    const icalContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//WhatTheFunFinder//Event//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${now}`,
        `DTSTART:${startDate}`,
        `DTEND:${formattedEndDate}`,
        `SUMMARY:${escapedName}`,
        escapedDescription ? `DESCRIPTION:${escapedDescription}` : '',
        escapedLocation ? `LOCATION:${escapedLocation}` : '',
        'STATUS:CONFIRMED',
        'SEQUENCE:0',
        'END:VEVENT',
        'END:VCALENDAR'
    ].filter(line => line).join('\r\n');
    
    return icalContent;
}

function generateCalendarLinks(event, siteUrl) {
    const { Name, Date: eventDate, Time: eventTime, Description, Location } = event.fields;
    
    if (!eventDate) {
        return {};
    }
    
    const eventName = encodeURIComponent(Name || 'Event');
    const eventDesc = encodeURIComponent(Description || '');
    const eventLoc = encodeURIComponent(Location || '');

    // Parse date in local timezone
    const startDate = new Date(eventDate + 'T00:00:00');
    if (eventTime) {
        const [hours, minutes] = eventTime.split(':');
        startDate.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
    } else {
        // Default to 11:00 AM if no time is provided
        startDate.setHours(11, 0, 0, 0);
    }

    const endDate = new Date(startDate);
    // If no time provided, use 8 hours (11 AM to 7 PM); otherwise use 2 hours default
    endDate.setHours(endDate.getHours() + (eventTime ? 2 : 8));
    
    const formatGoogleDate = (date) => date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const googleStart = formatGoogleDate(startDate);
    const googleEnd = formatGoogleDate(endDate);
    
    const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${eventName}&dates=${googleStart}/${googleEnd}&details=${eventDesc}&location=${eventLoc}`;
    
    const outlookStart = startDate.toISOString();
    const outlookEnd = endDate.toISOString();
    const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${eventName}&startdt=${outlookStart}&enddt=${outlookEnd}&body=${eventDesc}&location=${eventLoc}`;
    
    const yahooStart = formatGoogleDate(startDate);
    const yahooEnd = formatGoogleDate(endDate);
    const duration = Math.floor((endDate - startDate) / (1000 * 60 * 60)).toString().padStart(2, '0') + 
                     Math.floor(((endDate - startDate) % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
    const yahooUrl = `https://calendar.yahoo.com/?v=60&view=d&type=20&title=${eventName}&st=${yahooStart}&dur=${duration}&desc=${eventDesc}&in_loc=${eventLoc}`;
    
    return {
        google: googleCalendarUrl,
        outlook: outlookUrl,
        yahoo: yahooUrl,
        ical: `${siteUrl}/.netlify/functions/download-ical?eventId=${event.id}`
    };
}

module.exports = {
    generateICalContent,
    generateCalendarLinks
};
