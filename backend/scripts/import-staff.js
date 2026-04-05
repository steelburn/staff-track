import mysql from 'mysql2';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';

const connection = mysql.createConnection({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'stafftrack',
  password: process.env.MYSQL_PASSWORD || 'stafftrack_dev_password',
  database: process.env.MYSQL_DATABASE || 'stafftrack',
});

const filePath = path.join(__dirname, '../../public/files/Staff_List_With_Managers.csv');

fs.createReadStream(filePath)
  .pipe(csv())
  .on('data', async (row) => {
    if (!row.EmailAddress) {
      console.warn('Skipping row with empty EmailAddress:', row);
      return;
    }

    const query = `INSERT INTO staff (email, name, title, department, manager_name) VALUES (?, ?, ?, ?, ?)`;
    const values = [row.EmailAddress, row.Name, row.Title, row.Department, row.ManagerName];

    connection.query(query, values, (err) => {
      if (err) {
        console.error('Error inserting row:', err);
      }
    });
  })
  .on('end', () => {
    console.log('CSV file successfully processed and data inserted.');
    connection.end();
  });