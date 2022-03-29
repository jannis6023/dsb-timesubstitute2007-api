const axios = require("axios");
const querystring = require("querystring");
const cheerio = require('cheerio');
const express = require('express')
const bodyParser = require("body-parser");
const fs = require("fs");
const {remove} = require("cheerio/lib/api/manipulation");
const cors = require("cors");
const app = express()
const config = require('./config.json')
const port = config.port
const pushAPI = require('./pushServer')

app.use(cors())

app.get('/substitutes', ((req, res) => {
    const user = req.query.user;
    const pass = req.query.pass;
    axios.get('https://mobileapi.dsbcontrol.de/authid?pushid=&password=' + encodeURIComponent(pass) + '&osversion=15.4&bundleid=de.digitales-schwarzes-brett.dsblight&user=' + encodeURIComponent(user) + '&appversion=3.6.2')
        .then(r => {
            let authId = r.data;

            axios.get("https://mobileapi.dsbcontrol.de/dsbtimetables?authid=" + authId)
                .then(r => {
                    axios.get(r.data[0].Childs[0].Detail, {
                        responseEncoding: 'latin1'
                    })
                        .then(r => {
                            const html = r.data;
                            const $ = cheerio.load(html);
                            $('script').remove()
                            $('style').remove()
                            $('head').remove();

                            // Für jeden Tag

                            const days = [];

                            // iterate over days
                            $('div').each((index, el) => {
                                const day = {
                                    substitutes: []
                                }
                                const blocks = $(el).find('table');

                                // ========================== Datum START ==========================
                                day.date = $(el).find('table.KBlock.Kopf > tbody > tr:nth-child(1) > td.Datum.ohneumbruch').html()
                                // ========================== Datum ENDE ==========================

                                // ========================== Fehlende Räume START ==========================
                                if($(el).remove('table.VorspannBlock').find("table.VorspannBlock:nth-child(2) > tbody > tr > td:nth-child(2)").html() !== null){
                                    day.missingRooms = $(el).find("table.VorspannBlock:nth-child(2) > tbody > tr > td:nth-child(2)").html().split(', ')
                                }else{
                                    day.missingRooms = []
                                }
                                // ========================== Fehlende Räume ENDE ==========================


                                // ========================== Bitte beachten START ==========================
                                if($(el).find('table.BitteBeachtenBlock > tbody > tr > td:nth-child(2)').html() !== null){
                                    day.bitteBeachten = $(el).find('table.BitteBeachtenBlock > tbody > tr > td:nth-child(2)').html()
                                    if (day.bitteBeachten.split('<br>\n\n<br>\n').length > 0) {
                                        let beachtenTeile = day.bitteBeachten.split('<br>\n\n<br>\n');
                                        beachtenTeile = beachtenTeile.map(t => {
                                            return t.replace(/\n/g, '')
                                        })
                                        day.bitteBeachten = beachtenTeile
                                    }
                                }else{
                                    day.bitteBeachten = []
                                }
                                // ========================== Bitte beachten ENDE ==========================

                                // ========================== Vertretungen START ==========================
                                if($(el).find('table.VBlock').html() !== null){
                                    const substituteTable = $(el).find('table.VBlock');
                                    const tableRows = substituteTable.find('tr');

                                    let id = 1
                                    tableRows.each((rowIndex, rowEl) => {
                                        const row = {
                                            id: id,
                                            course: '',
                                            lesson: '',
                                            teacher: '',
                                            substitute: '',
                                            subject: '',
                                            room: '',
                                            description: ''
                                        }
                                        if(rowIndex > 0){
                                            $(rowEl).find('td').each((colIndex, colEl) => {
                                                switch (colIndex){
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

                            res.send(days);
                        })
                })
        })
}))
app.get('/getDifferences', (req, res) => {
    const user = req.query.user;
    const pass = req.query.pass;
    if(req.query.token === config.token){
        pushAPI.default(user, pass)
            .then(r => {
                res.send(JSON.stringify(r))
            })
            .catch(e => {
                res.status(500)
                res.send(JSON.stringify(e))
            })
    }else{
        res.status(401)
        res.send('{"error": "You are not authenticated - you\'re an idiot..."}')
    }
})

app.listen(port, () => {
    console.log(`DSB app listening on port ${port}`)
})