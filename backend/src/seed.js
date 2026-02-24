'use strict';
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Basic CSV parser
function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = splitLine(lines[0]);
    return lines.slice(1).filter(l => l.trim()).map(line => {
        const vals = splitLine(line);
        const obj = {};
        headers.forEach((h, i) => {
            let key = h.trim();
            // handle BOM or weird chars occasionally found in headers
            key = key.replace(/^\uFEFF/, '');
            obj[key] = (vals[i] || '').trim();
        });
        return obj;
    });
}

function splitLine(line) {
    const res = [];
    let cur = '', inQ = false;
    for (const c of line) {
        if (c === '"') { inQ = !inQ; continue; }
        if (c === ',' && !inQ) { res.push(cur); cur = ''; continue; }
        cur += c;
    }
    res.push(cur);
    return res;
}

function runSeed(db) {
    console.log('--- Checking database seeds ---');

    // 1. Seed Staff
    const staffCount = db.prepare('SELECT COUNT(*) as c FROM staff').get().c;
    if (staffCount === 0) {
        try {
            console.log('Seeding Staff records...');
            const txt = fs.readFileSync(path.join(__dirname, '../files/AD_Reporting_Structure_Detailed.csv'), 'utf-8');
            const staffList = parseCSV(txt);

            const insert = db.prepare(`
        INSERT INTO staff (email, name, title, department, manager_name) 
        VALUES (@email, @name, @title, @department, @manager_name)
      `);

            const tx = db.transaction((list) => {
                for (const s of list) {
                    let email = s.EmailAddress;
                    if (!email && s.UserLogonName) {
                        email = s.UserLogonName + '@zen.com.my';
                    }
                    if (!email) continue;

                    let mName = '';
                    if (s.ManagerDN) {
                        const match = s.ManagerDN.match(/CN=([^,]+)/);
                        if (match) mName = match[1];
                    }

                    insert.run({
                        email: email.toLowerCase(),
                        name: s.Name || '',
                        title: s.Title || '',
                        department: s.Department || '',
                        manager_name: mName
                    });
                }
            });
            tx(staffList);
            console.log(`✓ Seeded ${staffList.length} staff records.`);
        } catch (e) {
            console.error('Failed to seed staff:', e.message);
        }
    } else {
        console.log(`Staff table already populated (${staffCount} records).`);
    }

    // 2. Seed Projects Catalog
    const projCount = db.prepare('SELECT COUNT(*) as c FROM projects_catalog').get().c;
    if (projCount === 0) {
        try {
            console.log('Seeding Projects Catalog...');
            const txt = fs.readFileSync(path.join(__dirname, '../files/extracted_projects.csv'), 'utf-8');
            const projList = parseCSV(txt);

            const insert = db.prepare(`
        INSERT INTO projects_catalog (id, soc, project_name, customer, end_date) 
        VALUES (@id, @soc, @project_name, @customer, @end_date)
      `);

            const tx = db.transaction((list) => {
                for (const p of list) {
                    const name = p['Project Name'];
                    if (!name) continue;
                    insert.run({
                        id: uuidv4(),
                        soc: p.SOC || '',
                        project_name: name,
                        customer: p.Customer || '',
                        end_date: null // default no global end date
                    });
                }
            });
            tx(projList);
            console.log(`✓ Seeded ${projList.length} catalog projects.`);
        } catch (e) {
            console.error('Failed to seed projects:', e.message);
        }
    } else {
        console.log(`Projects Catalog already populated (${projCount} records).`);
    }

    console.log('--- Seeding complete ---');
}

module.exports = { runSeed };
