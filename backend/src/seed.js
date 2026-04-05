import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { parseCSV } from './utils.js';

function runSeed(db) {
    console.log('--- Checking database seeds ---');

    // 1. Seed Staff
    const staffCount = db.prepare('SELECT COUNT(*) as c FROM staff').get().c;
    if (staffCount === 0) {
        try {
            console.log('Seeding Staff records...');
            const txt = fs.readFileSync(path.join('/app/public/files/AD_Reporting_Structure_Detailed.csv'), 'utf-8');
            const staffList = parseCSV(txt);

            const insert = db.prepare(`
        INSERT INTO staff (email, name, title, department, manager_name) 
        VALUES (@email, @name, @title, @department, @manager_name)
      `);

            const tx = db.transaction((list) => {
                for (const s of list) {
                    // Support multiple CSV formats: "EmailAddress" or "Email" or "UserLogonName"
                    let email = (s.EmailAddress || s.Email || '').trim();
                    if (!email && s.UserLogonName) {
                        email = s.UserLogonName.trim() + '@zen.com.my';
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
            const txt = fs.readFileSync(path.join('/app/public/files/extracted_projects.csv'), 'utf-8');
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

export { runSeed };
