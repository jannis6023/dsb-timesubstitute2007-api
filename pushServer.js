"use strict";
exports.__esModule = true;
var axios_1 = require("axios");
var cheerio = require("cheerio");
var fs = require("fs");
var _ = require("lodash");
var DSB = require("dsbapi");
// Convert to 32bit integer
function stringToHash(string) {
    var hash = 0;
    if (string.length == 0)
        return hash;
    var char;
    for (var i = 0; i < string.length; i++) {
        char = string.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash;
}
function parseDate(input) {
    var parts = input.match(/(\d+)/g);
    // note parts[1]-1
    return new Date(Number(parts[2]), Number(Number(parts[1]) - 1), Number(parts[0]));
}
function checkDifferences(user, pass) {
    return new Promise(function (resolve, reject) {
        if (!fs.existsSync(user + '.json')) {
            fetch(user, pass)
                .then(function (days) {
                fs.writeFileSync(user + '.json', JSON.stringify(days), { encoding: 'latin1' });
            });
            resolve([]);
        }
        var data = fs.readFileSync(user + '.json', { encoding: 'latin1' });
        var oldDays = JSON.parse(data);
        var changes = [];
        fetch(user, pass)
            .then(function (days) {
            days.forEach(function (d, index) {
                if (oldDays.some(function (fd) { return fd.date === d.date; })) {
                    var oldDay_1 = oldDays.filter(function (fd) { return fd.date === d.date; })[0];
                    // Tag noch da
                    // => Version prüfen
                    if (oldDay_1.lastChange !== d.lastChange) {
                        if (!_.isEqual(oldDay_1.substitutes, d.substitutes)) {
                            // Änderung in Vertretungen
                            d.substitutes.forEach(function (s) {
                                if (oldDay_1.substitutes.some(function (os) { return _.isEqual(os, s); })) {
                                    // Vertretung noch da, unverändert
                                }
                                else {
                                    // Vertretung neu oder geändert
                                    if (oldDay_1.substitutes.some(function (os) { return os.course === s.course && os.teacher === s.teacher; })) {
                                        var oldSub = oldDay_1.substitutes.filter(function (os) { return os.course === s.course && os.teacher === s.teacher; })[0];
                                        changes.push(compareSubstitutes(d, oldSub, s));
                                    }
                                    else {
                                        // Vertretung neu
                                        var change = {
                                            date: d.date,
                                            changes: [],
                                            newSubstitute: s
                                        };
                                        changes.push(change);
                                    }
                                }
                            });
                            oldDay_1.substitutes.filter(function (s) { return !d.substitutes.some(function (newS) { return newS.lesson === s.lesson && newS.teacher === s.teacher; }); }).forEach(function (newSub) {
                                var change = {
                                    changes: [],
                                    date: d.date,
                                    oldSubstitute: newSub
                                };
                                changes.push(change);
                            });
                        }
                    }
                }
                else {
                    if (oldDays.length > 0) {
                        if (parseDate(oldDays[oldDays.length - 1].date.split(", ")[1]) < parseDate(d.date.split(", ")[1])) {
                            // Neuer Tag
                            d.substitutes.forEach(function (newSub) {
                                var change = {
                                    changes: [],
                                    date: d.date,
                                    newSubstitute: newSub
                                };
                                changes.push(change);
                            });
                        }
                        else {
                            // Tag gelöscht, nix machen
                        }
                    }
                    else {
                        // Neuer Tag
                        d.substitutes.forEach(function (newSub) {
                            var change = {
                                changes: [],
                                date: d.date,
                                newSubstitute: newSub
                            };
                            changes.push(change);
                        });
                    }
                }
            });
            fs.writeFileSync(user + '.json', JSON.stringify(days), { encoding: 'latin1' });
            resolve(changes);
        })["catch"](function (e) {
            reject(e);
        });
    });
}
exports["default"] = checkDifferences;
function compareSubstitutes(day, oldSub, newSub) {
    var s = newSub;
    var sChange = {
        changes: [],
        date: day.date,
        newSubstitute: s,
        oldSubstitute: oldSub
    };
    if (oldSub.room !== s.room) {
        var change = {
            key: 'room',
            oldVal: oldSub.room,
            newVal: s.room
        };
        sChange.changes.push(change);
    }
    if (oldSub.substitute !== s.substitute) {
        var change = {
            key: 'substitute',
            oldVal: oldSub.substitute,
            newVal: s.substitute
        };
        sChange.changes.push(change);
    }
    if (oldSub.description !== s.description) {
        var change = {
            key: 'description',
            oldVal: oldSub.description,
            newVal: s.description
        };
        sChange.changes.push(change);
    }
    if (oldSub.subject !== s.subject) {
        var change = {
            key: 'description',
            oldVal: oldSub.description,
            newVal: s.description
        };
        sChange.changes.push(change);
    }
    return sChange;
}
function fetch(user, pass) {
    return new Promise(function (resolve, reject) {
        var dsb = new DSB(user, pass);
        dsb.fetch()
            .then(function (data) {
            var timetables = DSB.findMethodInData('timetable', data);
            axios_1["default"].get(timetables.data[0].url, {
                responseEncoding: 'latin1'
            })
                .then(function (r) {
                var html = r.data;
                var $ = cheerio.load(html);
                $('script').remove();
                $('style').remove();
                $('head').remove();
                // Für jeden Tag
                var days = [];
                // iterate over days
                $('div').each(function (index, el) {
                    var day = {
                        date: '',
                        lastChange: '',
                        missingRooms: [],
                        bitteBeachten: [],
                        substitutes: []
                    };
                    var blocks = $(el).find('table');
                    // ========================== Datum START ==========================
                    day.date = $(el).find('table.KBlock.Kopf > tbody > tr:nth-child(1) > td.Datum.ohneumbruch').html() || "";
                    // ========================== Datum ENDE ==========================
                    // ========================== LastChange START ==========================
                    day.lastChange = $(el).find('table.KBlock.Kopf > tbody > tr:nth-child(2) > td.normal.right.ohneumbruch').html() || "";
                    // ========================== LastChange END ==========================
                    // ========================== Fehlende Räume START ==========================
                    if ($(el).remove('table.VorspannBlock').find("table.VorspannBlock:nth-child(2) > tbody > tr > td:nth-child(2)").html() !== null) {
                        day.missingRooms = ($(el).find("table.VorspannBlock:nth-child(2) > tbody > tr > td:nth-child(2)").html() || "").split(', ');
                    }
                    else {
                        day.missingRooms = [];
                    }
                    // ========================== Fehlende Räume ENDE ==========================
                    // ========================== Bitte beachten START ==========================
                    if ($(el).find('table.BitteBeachtenBlock > tbody > tr > td:nth-child(2)').html() !== null) {
                        var bitteBeachten = "";
                        bitteBeachten = $(el).find('table.BitteBeachtenBlock > tbody > tr > td:nth-child(2)').html() || "";
                        if (bitteBeachten.split('<br>\n\n<br>\n').length > 0) {
                            var beachtenTeile = bitteBeachten.split('<br>\n\n<br>\n');
                            beachtenTeile = beachtenTeile.map(function (t) {
                                return t.replace(/\n/g, '');
                            });
                            day.bitteBeachten = beachtenTeile;
                        }
                    }
                    else {
                        day.bitteBeachten = [];
                    }
                    // ========================== Bitte beachten ENDE ==========================
                    // ========================== Vertretungen START ==========================
                    if ($(el).find('table.VBlock').html() !== null) {
                        var substituteTable = $(el).find('table.VBlock');
                        var tableRows = substituteTable.find('tr');
                        var id_1 = 1;
                        tableRows.each(function (rowIndex, rowEl) {
                            var row = {
                                course: '',
                                lesson: '',
                                teacher: '',
                                substitute: '',
                                subject: '',
                                room: '',
                                description: ''
                            };
                            if (rowIndex > 0) {
                                $(rowEl).find('td').each(function (colIndex, colEl) {
                                    switch (colIndex) {
                                        case 0:
                                            row.course = $(colEl).text();
                                            break;
                                        case 1:
                                            row.lesson = $(colEl).text();
                                            break;
                                        case 2:
                                            row.teacher = $(colEl).text();
                                            break;
                                        case 3:
                                            row.substitute = $(colEl).text();
                                            break;
                                        case 4:
                                            row.subject = $(colEl).text();
                                            break;
                                        case 5:
                                            row.room = $(colEl).text();
                                            break;
                                        case 6:
                                            row.description = $(colEl).text();
                                            break;
                                    }
                                });
                                day.substitutes.push(row);
                                id_1++;
                            }
                        });
                    }
                    // ========================== Vertretungen ENDE ==========================
                    days.push(day);
                });
                resolve(days);
            });
        });
    });
}
