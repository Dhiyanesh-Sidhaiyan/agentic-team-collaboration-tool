const fs = require('fs');
const path = require('path');

function checkProjectQuality() {
  console.log('--- Project Quality & Security Audit ---');
  
  const serverPath = path.join(__dirname, 'server.js');
  const serverContent = fs.readFileSync(serverPath, 'utf8');
  
  const packagePath = path.join(__dirname, 'package.json');
  const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  const criteria = [
    { name: 'Helmet Security', pattern: /helmet\(/, description: 'Secure headers implementation' },
    { name: 'Cloud Logging', pattern: /LoggingWinston/, description: 'GCP Logging integration' },
    { name: 'Cloud Storage', pattern: /new Storage\(/, description: 'GCP Storage integration' },
    { name: 'Secret Manager', pattern: /SecretManagerServiceClient/, description: 'Secure key management' },
    { name: 'Real-time Socket', pattern: /new Server\(server/, description: 'Socket.io implementation' },
    { name: 'AI Integration', pattern: /\/api\/ai\/summarize/, description: 'AI API endpoint' },
    { name: 'Task Management', pattern: /\/api\/tasks/, description: 'Tasks CRUD API' },
    { name: 'Backend Validation', pattern: /validateString/, description: 'Input validation on server' }
  ];

  const htmlPath = path.join(__dirname, 'public', 'index.html');
  const htmlContent = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  const frontendCriteria = [
    { name: 'Frontend Validation', pattern: /text\.length >/, description: 'Input validation in UI' }
  ];

  let passed = 0;
  [...criteria, ...frontendCriteria].forEach(c => {
    const targetContent = criteria.includes(c) ? serverContent : htmlContent;
    if (c.pattern.test(targetContent)) {
      console.log(`✅ [PASSED] ${c.name}: ${c.description}`);
      passed++;
    } else {
      console.log(`❌ [FAILED] ${c.name}: ${c.description}`);
    }
  });

  const totalCriteria = criteria.length + frontendCriteria.length;
  console.log(`\nAudit Score: ${passed}/${totalCriteria}`);
}

checkProjectQuality();
