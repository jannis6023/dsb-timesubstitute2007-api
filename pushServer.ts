import axios from "axios";
import * as cheerio from "cheerio"
import * as fs from "fs";
import * as _ from "lodash";
import {remove} from "cheerio/lib/api/manipulation";
import {isEqual} from "lodash";
import * as DSB from "dsbapi"

interface SubstituteLesson{
    id?: number
    course: string
    lesson: string
    teacher: string
    substitute: string
    subject: string
    room: string
    description: string
}

interface SubstituteDay{
    substitutes: SubstituteLesson[]
    date: string
    lastChange: string
    missingRooms: string[]
    bitteBeachten: string[]
}

interface SubstituteChange{
    date: string
    newSubstitute?: SubstituteLesson
    oldSubstitute?: SubstituteLesson
    changes: Change[]
}

interface Change{
    key: string
    oldVal: string
    newVal: string
}

// Convert to 32bit integer
function stringToHash(string: string) {

    var hash = 0;

    if (string.length == 0) return hash;

    let char;
    for (let i = 0; i < string.length; i++) {
        char = string.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }

    return hash;
}

export default function checkDifferences(user: string, pass: string): Promise<SubstituteChange[]> {
    return new Promise((resolve, reject) => {
        if(!fs.existsSync(user + '.json')){
            fetch(user, pass)
                .then(days => {
                    fs.writeFileSync(user + '.json', JSON.stringify(days), {encoding: 'latin1'})
                })
            resolve([])
        }

        const data = fs.readFileSync(user + '.json', {encoding: 'latin1'})
        const oldDays: SubstituteDay[] = JSON.parse(data);

        const changes: SubstituteChange[] = [];

        fetch(user, pass)
            .then(days => {
                days.forEach((d, index) => {
                    if(oldDays.some(fd => fd.date === d.date)){
                        const oldDay = oldDays.filter(fd => fd.date === d.date)[0];
                        // Tag noch da
                        // => Version prüfen
                        if(oldDay.lastChange !== d.lastChange){
                            if(!_.isEqual(oldDay.substitutes, d.substitutes)){
                                // Änderung in Vertretungen
                                d.substitutes.forEach(s => {
                                    if(oldDay.substitutes.some(os => _.isEqual(os, s))){
                                        // Vertretung noch da, unverändert
                                    }else{
                                        // Vertretung neu oder geändert
                                        if(oldDay.substitutes.some(os => os.course === s.course && os.teacher === s.teacher)){
                                            const oldSub = oldDay.substitutes.filter(os => os.course === s.course && os.teacher === s.teacher)[0];
                                            changes.push(compareSubstitutes(d, oldSub, s));
                                        }else{
                                            // Vertretung neu
                                            const change: SubstituteChange = {
                                                date: d.date,
                                                changes: [],
                                                newSubstitute: s
                                            }
                                            changes.push(change)
                                        }
                                    }
                                })
                                oldDay.substitutes.filter(s => !d.substitutes.some(newS => newS.lesson === s.lesson && newS.teacher === s.teacher)).forEach(newSub => {
                                    const change: SubstituteChange = {
                                        changes: [],
                                        date: d.date,
                                        newSubstitute: newSub
                                    }
                                    changes.push(change)
                                })
                            }
                        }
                    }else{
                        if(index === days.length-1){
                            // Neuer Tag
                            d.substitutes.forEach(newSub => {
                                const change: SubstituteChange = {
                                    changes: [],
                                    date: d.date,
                                    newSubstitute: newSub
                                }
                                changes.push(change)
                            })
                        }
                    }
                })
                fs.writeFileSync(user + '.json', JSON.stringify(days), {encoding: 'latin1'})
                resolve(changes)
            })
            .catch(e => {
                reject(e)
            })
    })
}

function compareSubstitutes(day: SubstituteDay, oldSub: SubstituteLesson, newSub: SubstituteLesson): SubstituteChange{
    const s = newSub;
    const sChange: SubstituteChange = {
        changes: [],
        date: day.date,
        newSubstitute: s,
        oldSubstitute: oldSub
    }

    if(oldSub.room !== s.room){
        const change: Change = {
            key: 'room',
            oldVal: oldSub.room,
            newVal: s.room
        }
        sChange.changes.push(change)
    }

    if(oldSub.substitute !== s.substitute){
        const change: Change = {
            key: 'substitute',
            oldVal: oldSub.substitute,
            newVal: s.substitute
        }
        sChange.changes.push(change)
    }

    if(oldSub.description !== s.description){
        const change: Change = {
            key: 'description',
            oldVal: oldSub.description,
            newVal: s.description
        }
        sChange.changes.push(change)
    }

    if(oldSub.subject !== s.subject){
        const change: Change = {
            key: 'description',
            oldVal: oldSub.description,
            newVal: s.description
        }
        sChange.changes.push(change)
    }

    return sChange;
}

function fetch(user: string, pass: string): Promise<SubstituteDay[]> {
    return new Promise<SubstituteDay[]>((resolve, reject) => {
        const dsb = new DSB(user, pass);
        dsb.fetch()
            .then(data => {
                const timetables = DSB.findMethodInData('timetable', data);
                axios.get(timetables.data[0].url, {
                    responseEncoding: 'latin1'
                })
                    .then(r => {
                        const html = r.data;
                        const $ = cheerio.load(html);
                        $('script').remove()
                        $('style').remove()
                        $('head').remove();

                        // Für jeden Tag

                        const days: SubstituteDay[] = [];

                        // iterate over days
                        $('div').each((index, el) => {
                            const day: SubstituteDay = {
                                date: '',
                                lastChange: '',
                                missingRooms: [],
                                bitteBeachten: [],
                                substitutes: []
                            }
                            const blocks = $(el).find('table');

                            // ========================== Datum START ==========================
                            day.date = $(el).find('table.KBlock.Kopf > tbody > tr:nth-child(1) > td.Datum.ohneumbruch').html() || ""
                            // ========================== Datum ENDE ==========================

                            // ========================== LastChange START ==========================
                            day.lastChange = $(el).find('table.KBlock.Kopf > tbody > tr:nth-child(2) > td.normal.right.ohneumbruch').html() || ""
                            // ========================== LastChange END ==========================

                            // ========================== Fehlende Räume START ==========================
                            if ($(el).remove('table.VorspannBlock').find("table.VorspannBlock:nth-child(2) > tbody > tr > td:nth-child(2)").html() !== null) {
                                day.missingRooms = ($(el).find("table.VorspannBlock:nth-child(2) > tbody > tr > td:nth-child(2)").html() || "").split(', ')
                            } else {
                                day.missingRooms = []
                            }
                            // ========================== Fehlende Räume ENDE ==========================


                            // ========================== Bitte beachten START ==========================
                            if ($(el).find('table.BitteBeachtenBlock > tbody > tr > td:nth-child(2)').html() !== null) {
                                let bitteBeachten = "";
                                bitteBeachten = $(el).find('table.BitteBeachtenBlock > tbody > tr > td:nth-child(2)').html() || ""
                                if (bitteBeachten.split('<br>\n\n<br>\n').length > 0) {
                                    let beachtenTeile = bitteBeachten.split('<br>\n\n<br>\n');
                                    beachtenTeile = beachtenTeile.map(t => {
                                        return t.replace(/\n/g, '')
                                    })
                                    day.bitteBeachten = beachtenTeile
                                }
                            } else {
                                day.bitteBeachten = []
                            }
                            // ========================== Bitte beachten ENDE ==========================

                            // ========================== Vertretungen START ==========================
                            if ($(el).find('table.VBlock').html() !== null) {
                                const substituteTable = $(el).find('table.VBlock');
                                const tableRows = substituteTable.find('tr');

                                let id = 1
                                tableRows.each((rowIndex, rowEl) => {
                                    const row: SubstituteLesson = {
                                        course: '',
                                        lesson: '',
                                        teacher: '',
                                        substitute: '',
                                        subject: '',
                                        room: '',
                                        description: ''
                                    }
                                    if (rowIndex > 0) {
                                        $(rowEl).find('td').each((colIndex, colEl) => {
                                            switch (colIndex) {
                                                case 0:
                                                    row.course = $(colEl).text()
                                                    break;
                                                case 1:
                                                    row.lesson = $(colEl).text()
                                                    break;
                                                case 2:
                                                    row.teacher = $(colEl).text()
                                                    break;
                                                case 3:
                                                    row.substitute = $(colEl).text()
                                                    break;
                                                case 4:
                                                    row.subject = $(colEl).text()
                                                    break;
                                                case 5:
                                                    row.room = $(colEl).text()
                                                    break;
                                                case 6:
                                                    row.description = $(colEl).text()
                                                    break;
                                            }
                                        })
                                        day.substitutes.push(row)
                                        id++;
                                    }
                                })
                            }
                            // ========================== Vertretungen ENDE ==========================

                            days.push(day);
                        })

                        resolve(days)
                    })
            })
    })
}