import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

const BEESUITE_API_BASE = process.env.BEESUITE_API_URL || 'https://appcore.beesuite.app';
const BEESUITE_EMAIL = process.env.BEESUITE_EMAIL || 'khairulnizam@zen.com.my';
const BEESUITE_PASSWORD = process.env.BEESUITE_PASSWORD || 'RXZlcnlvbmUjNzkwMTI0MDY1NDYz';

/**
 * Get BeeSuite access token
 */
async function getBeesuiteToken() {
    const authResponse = await axios.post(`${BEESUITE_API_BASE}/api/auth/login`, {
        email: BEESUITE_EMAIL,
        password: BEESUITE_PASSWORD
    });
    return authResponse.data.access_token;
}

/**
 * Seed database from BeeSuite API (replaces CSV-based seeding)
 * @param {Object} db - Database connection wrapper
 */
async function runSeed(db) {
    console.log('--- Checking database seeds ---');

    // Check if staff table is empty
    const [staffResult] = await db.query('SELECT COUNT(*) as c FROM staff');
    const staffCount = staffResult[0].c;

    if (staffCount === 0) {
        try {
            console.log('Seeding Staff from BeeSuite API...');
            const accessToken = await getBeesuiteToken();

            const staffResponse = await axios.get(`${BEESUITE_API_BASE}/api/users/staff`, {
                headers: { 'Authorization': `JWT ${accessToken}` }
            });

            let staffList = staffResponse.data;
            if (!Array.isArray(staffList)) {
                throw new Error('Invalid response format from BeeSuite API');
            }

            // Filter to same company
            const referenceCompanyId = staffList.length > 0 ? staffList[0].companyId : null;
            staffList = staffList.filter(s => s.companyId === referenceCompanyId);

            let added = 0;
            for (const staff of staffList) {
                const email = staff.email;
                const name = staff.employeeName;
                const title = staff.designation;
                const department = staff.department;

                if (!email || !name) continue;

                // Check if exists
                const [existing] = await db.query('SELECT email FROM staff WHERE email = ?', [email]);
                if (existing.length === 0) {
                    // Get manager info
                    let managerName = null;
                    try {
                        const empRes = await axios.get(
                            `${BEESUITE_API_BASE}/api/admin/user-info-details/employment-detail/${staff.id}`,
                            { headers: { 'Authorization': `JWT ${accessToken}` } }
                        );
                        if (empRes.data?.employmentDetail?.reportingToName) {
                            managerName = empRes.data.employmentDetail.reportingToName;
                        }
                    } catch (e) {
                        // Ignore errors fetching employment details
                    }

                    await db.query(
                        'INSERT INTO staff (email, name, title, department, manager_name) VALUES (?, ?, ?, ?, ?)',
                        [email, name, title, department, managerName]
                    );
                    added++;
                }
            }
            console.log(`✓ Seeded ${added} staff records from BeeSuite.`);
        } catch (e) {
            console.error('Failed to seed staff from BeeSuite:', e.message);
        }
    } else {
        console.log(`Staff table already populated (${staffCount} records).`);
    }

    // Check if projects catalog is empty
    const [projResult] = await db.query('SELECT COUNT(*) as c FROM projects_catalog');
    const projCount = projResult[0].c;

    if (projCount === 0) {
        try {
            console.log('Seeding Projects Catalog from BeeSuite API...');
            const accessToken = await getBeesuiteToken();

            const response = await axios.get(`${BEESUITE_API_BASE}/admin/soc/list`, {
                headers: { 'Authorization': `JWT ${accessToken}` }
            });

            let socList = response.data;
            if (socList && socList.data) {
                socList = socList.data;
            }
            if (!Array.isArray(socList)) {
                throw new Error('Invalid response format from BeeSuite API');
            }

            let added = 0;
            for (const item of socList) {
                const soc = item.soc || item.soc_code || item.code || '';
                const projectName = item.project_name || item.name || item.projectName || '';
                const customer = item.customer || item.client || item.customer_name || '';
                const startDate = item.start_date || item.startDate || null;
                const endDate = item.end_date || item.endDate || null;

                if (!soc && !projectName) continue;

                await db.query(
                    `INSERT INTO projects_catalog (id, soc, project_name, customer, start_date, end_date)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [uuidv4(), soc, projectName, customer, startDate, endDate]
                );
                added++;
            }
            console.log(`✓ Seeded ${added} catalog projects from BeeSuite.`);
        } catch (e) {
            console.error('Failed to seed projects from BeeSuite:', e.message);
        }
    } else {
        console.log(`Projects Catalog already populated (${projCount} records).`);
    }

    console.log('--- Seeding complete ---');
}

export { runSeed };
