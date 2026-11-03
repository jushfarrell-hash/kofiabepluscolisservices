const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const dbPath = path.join(__dirname, 'data', 'colis.db');
const sessionSecret = process.env.SESSION_SECRET || (isProduction ? null : 'colis-service-secret-key');

if (isProduction && (!sessionSecret || !process.env.ADMIN_PASSWORD)) {
  throw new Error('SESSION_SECRET and ADMIN_PASSWORD must be configured in production.');
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new sqlite3.Database(dbPath);

if (isProduction) app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.dirname(dbPath) }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: isProduction, maxAge: 60 * 60 * 1000 }
  })
);

const APP_TITLE = 'COLIS SERVICE';
app.locals.APP_TITLE = APP_TITLE;

function ensureAuthenticated(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function ensureAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'ADMIN') {
    return res.status(403).render('403', { user: req.session.user || null, title: 'Accès refusé' });
  }
  next();
}

function formatDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleString('fr-FR');
}

function calculatePrice({ weight, length, width, height, fromCity, toCity }) {
  const distanceMap = {
    'Antananarivo-Toamasina': 350,
    'Antananarivo-Fianarantsoa': 300,
    'Antananarivo-Mahajanga': 650,
    'Toamasina-Antananarivo': 350,
    'Toamasina-Fianarantsoa': 420,
    'Toamasina-Mahajanga': 700,
    'Fianarantsoa-Antananarivo': 300,
    'Fianarantsoa-Toamasina': 420,
    'Fianarantsoa-Mahajanga': 820,
    'Mahajanga-Antananarivo': 650,
    'Mahajanga-Toamasina': 700,
    'Mahajanga-Fianarantsoa': 820
  };

  const distance = distanceMap[`${fromCity}-${toCity}`] || distanceMap[`${toCity}-${fromCity}`] || 300;
  const volumetric = (Number(length) * Number(width) * Number(height)) / 5000;
  const facturableWeight = Math.max(Number(weight), volumetric, 0.5);

  const basePrice = 9000;
  const weightCost = facturableWeight * 1300;
  const distanceCost = distance * 140;
  const serviceFee = 1800;
  const total = Math.round(basePrice + weightCost + distanceCost + serviceFee);

  return {
    distance,
    volumetric: Number(volumetric.toFixed(2)),
    facturableWeight: Number(facturableWeight.toFixed(2)),
    total,
    detail: {
      basePrice,
      weightCost: Number(weightCost.toFixed(2)),
      distanceCost,
      serviceFee
    }
  };
}

function buildTrackingCode() {
  const prefix = 'CS';
  const random = Math.random().toString(36).slice(2, 9).toUpperCase();
  return `${prefix}-${random}`;
}

function initDatabase() {
  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS agencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE,
        name TEXT,
        city TEXT,
        address TEXT,
        phone TEXT,
        status TEXT DEFAULT 'ACTIVE'
      )`
    );

    db.run(
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        phone TEXT,
        password TEXT,
        role TEXT,
        agency_id INTEGER,
        status TEXT DEFAULT 'ACTIVE'
      )`
    );

    db.run(
      `CREATE TABLE IF NOT EXISTS cities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        region TEXT,
        latitude REAL,
        longitude REAL
      )`
    );

    db.run(
      `CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_city TEXT,
        to_city TEXT,
        distance_km INTEGER,
        duration_hours INTEGER,
        status TEXT DEFAULT 'ACTIVE'
      )`
    );

    db.run(
      `CREATE TABLE IF NOT EXISTS shipments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tracking_code TEXT UNIQUE,
        sender_name TEXT,
        sender_phone TEXT,
        sender_address TEXT,
        recipient_name TEXT,
        recipient_phone TEXT,
        recipient_city TEXT,
        recipient_address TEXT,
        weight REAL,
        length REAL,
        width REAL,
        height REAL,
        service TEXT,
        description TEXT,
        from_city TEXT,
        to_city TEXT,
        amount REAL,
        paid_amount REAL DEFAULT 0,
        status TEXT,
        agency_id INTEGER,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`
    );

    db.run(
      `CREATE TABLE IF NOT EXISTS shipment_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shipment_id INTEGER,
        status TEXT,
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER
      )`
    );

    db.run(
      `CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shipment_id INTEGER,
        amount REAL,
        method TEXT,
        reference TEXT UNIQUE,
        status TEXT DEFAULT 'CONFIRMED',
        agent_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`
    );

    db.run(
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT,
        object_type TEXT,
        object_id INTEGER,
        details TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`
    );

    db.run('INSERT OR IGNORE INTO cities (name, region) VALUES (?, ?)', ['Antananarivo', 'Analamanga']);
    db.run('INSERT OR IGNORE INTO cities (name, region) VALUES (?, ?)', ['Toamasina', 'Atsinanana']);
    db.run('INSERT OR IGNORE INTO cities (name, region) VALUES (?, ?)', ['Fianarantsoa', 'Vatovavy']);
    db.run('INSERT OR IGNORE INTO cities (name, region) VALUES (?, ?)', ['Mahajanga', 'Boeny']);

    db.run('INSERT OR IGNORE INTO routes (from_city, to_city, distance_km, duration_hours) VALUES (?, ?, ?, ?)', ['Antananarivo', 'Toamasina', 350, 12]);
    db.run('INSERT OR IGNORE INTO routes (from_city, to_city, distance_km, duration_hours) VALUES (?, ?, ?, ?)', ['Antananarivo', 'Fianarantsoa', 300, 10]);
    db.run('INSERT OR IGNORE INTO routes (from_city, to_city, distance_km, duration_hours) VALUES (?, ?, ?, ?)', ['Antananarivo', 'Mahajanga', 650, 18]);
    db.run('INSERT OR IGNORE INTO routes (from_city, to_city, distance_km, duration_hours) VALUES (?, ?, ?, ?)', ['Toamasina', 'Antananarivo', 350, 12]);
    db.run('INSERT OR IGNORE INTO routes (from_city, to_city, distance_km, duration_hours) VALUES (?, ?, ?, ?)', ['Toamasina', 'Fianarantsoa', 420, 14]);
    db.run('INSERT OR IGNORE INTO routes (from_city, to_city, distance_km, duration_hours) VALUES (?, ?, ?, ?)', ['Toamasina', 'Mahajanga', 700, 20]);
    db.run('INSERT OR IGNORE INTO routes (from_city, to_city, distance_km, duration_hours) VALUES (?, ?, ?, ?)', ['Fianarantsoa', 'Antananarivo', 300, 10]);
    db.run('INSERT OR IGNORE INTO routes (from_city, to_city, distance_km, duration_hours) VALUES (?, ?, ?, ?)', ['Fianarantsoa', 'Toamasina', 420, 14]);
    db.run('INSERT OR IGNORE INTO routes (from_city, to_city, distance_km, duration_hours) VALUES (?, ?, ?, ?)', ['Fianarantsoa', 'Mahajanga', 820, 24]);
    db.run('INSERT OR IGNORE INTO routes (from_city, to_city, distance_km, duration_hours) VALUES (?, ?, ?, ?)', ['Mahajanga', 'Antananarivo', 650, 18]);
    db.run('INSERT OR IGNORE INTO routes (from_city, to_city, distance_km, duration_hours) VALUES (?, ?, ?, ?)', ['Mahajanga', 'Toamasina', 700, 20]);
    db.run('INSERT OR IGNORE INTO routes (from_city, to_city, distance_km, duration_hours) VALUES (?, ?, ?, ?)', ['Mahajanga', 'Fianarantsoa', 820, 24]);

    db.get('SELECT COUNT(*) as count FROM agencies', (err, row) => {
      if (!err && row && row.count === 0) {
        db.run('INSERT INTO agencies (code, name, city, address, phone, status) VALUES (?, ?, ?, ?, ?, ?)', ['TNR', 'Agence Antananarivo', 'Antananarivo', 'Avenue de l’Indépendance', '+261 20 000 00', 'ACTIVE']);
        db.run('INSERT INTO agencies (code, name, city, address, phone, status) VALUES (?, ?, ?, ?, ?, ?)', ['TMS', 'Agence Toamasina', 'Toamasina', 'Rue du Port', '+261 22 000 00', 'ACTIVE']);
      }
    });

    db.get('SELECT COUNT(*) as count FROM users', async (err, row) => {
      if (!err && row && row.count === 0) {
        const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10);
        db.run(
          'INSERT INTO users (name, email, phone, password, role, agency_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ['Admin général', 'admin@colis.mg', '+261 34 000 00', passwordHash, 'ADMIN', 1, 'ACTIVE']
        );
        if (!isProduction) {
          db.run(
            'INSERT INTO users (name, email, phone, password, role, agency_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ['Agent Antananarivo', 'agent@colis.mg', '+261 34 111 11', await bcrypt.hash('agent123', 10), 'AGENT', 1, 'ACTIVE']
          );
        }
      }
    });

    db.get('SELECT COUNT(*) as count FROM shipments', (err, row) => {
      if (!isProduction && !err && row && row.count === 0) {
        const tracking1 = buildTrackingCode();
        const tracking2 = buildTrackingCode();
        const now = new Date().toISOString();
        db.run(
          `INSERT INTO shipments (
            tracking_code, sender_name, sender_phone, sender_address, recipient_name, recipient_phone,
            recipient_city, recipient_address, weight, length, width, height, service, description,
            from_city, to_city, amount, paid_amount, status, agency_id, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ['CS-TEST-001', 'Rangy', '+261 34 222 22', 'Antananarivo', 'Naina', '+261 34 333 33', 'Toamasina', 'Rue du Port', 3.5, 40, 30, 25, 'EXPRESS', 'Produit alimentaire', 'Antananarivo', 'Toamasina', 42000, 42000, 'LIVRE', 1, 1, now, now]
        );
        db.run(
          `INSERT INTO shipments (
            tracking_code, sender_name, sender_phone, sender_address, recipient_name, recipient_phone,
            recipient_city, recipient_address, weight, length, width, height, service, description,
            from_city, to_city, amount, paid_amount, status, agency_id, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ['CS-TEST-002', 'Tiana', '+261 34 444 44', 'Fianarantsoa', 'Mihaja', '+261 34 555 55', 'Mahajanga', 'Bd de la Mer', 5, 50, 40, 35, 'STANDARD', 'Electroménager', 'Fianarantsoa', 'Mahajanga', 63000, 30000, 'EN_TRANSIT', 2, 1, now, now]
        );
        db.run('INSERT INTO shipment_events (shipment_id, status, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)', [1, 'ENREGISTRE', 'Colis créé et tarif figé.', now, 1]);
        db.run('INSERT INTO shipment_events (shipment_id, status, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)', [2, 'EN_TRANSIT', 'Transfert initialisé vers l’agence de destination.', now, 1]);
      }
    });
  });
}

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login', { title: 'Connexion', error: '', user: null });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { title: 'Connexion', error: 'Email et mot de passe requis.', user: null });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err || !user) {
      return res.render('login', { title: 'Connexion', error: 'Identifiants invalides.', user: null });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.render('login', { title: 'Connexion', error: 'Identifiants invalides.', user: null });
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      agency_id: user.agency_id
    };

    res.redirect('/dashboard');
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/dashboard', ensureAuthenticated, (req, res) => {
  const query = `
    SELECT
      (SELECT COUNT(*) FROM shipments) AS total_shipments,
      (SELECT COUNT(*) FROM shipments WHERE status = 'LIVRE') AS delivered,
      (SELECT COUNT(*) FROM shipments WHERE status = 'EN_TRANSIT') AS in_transit,
      (SELECT COUNT(*) FROM agencies) AS total_agencies,
      (SELECT SUM(amount - paid_amount) FROM shipments WHERE amount > paid_amount) AS unpaid_amount
  `;

  db.get(query, (err, stats) => {
    if (err) {
      return res.status(500).send('Erreur de lecture du tableau de bord');
    }

    db.all('SELECT * FROM shipments ORDER BY created_at DESC LIMIT 8', (error, shipments) => {
      res.render('dashboard', {
        title: 'Tableau de bord',
        user: req.session.user,
        stats,
        shipments: shipments || [],
        APP_TITLE
      });
    });
  });
});

app.get('/agencies', ensureAuthenticated, (req, res) => {
  db.all('SELECT * FROM agencies ORDER BY name', (err, agencies) => {
    if (err) return res.status(500).send('Erreur de lecture des agences');
    res.render('agencies', {
      title: 'Agences',
      user: req.session.user,
      agencies: agencies || [],
      APP_TITLE
    });
  });
});

app.get('/users', ensureAuthenticated, ensureAdmin, (req, res) => {
  db.all(
    `SELECT u.*, a.name as agency_name FROM users u LEFT JOIN agencies a ON a.id = u.agency_id ORDER BY u.id`,
    (err, users) => {
      if (err) return res.status(500).send('Erreur de lecture des comptes');
      db.all('SELECT * FROM agencies ORDER BY name', (agencyErr, agencies) => {
        res.render('users', {
          title: 'Comptes utilisateurs',
          user: req.session.user,
          users: users || [],
          agencies: agencies || [],
          APP_TITLE
        });
      });
    }
  );
});

app.post('/users', ensureAuthenticated, ensureAdmin, async (req, res) => {
  const { name, email, phone, role, agency_id, password } = req.body;

  if (!name || !email || !role || !password) {
    return res.status(400).send('Nom, email, rôle et mot de passe sont obligatoires');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  db.run(
    'INSERT INTO users (name, email, phone, password, role, agency_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [name, email, phone || '', passwordHash, role, agency_id || null, 'ACTIVE'],
    (err) => {
      if (err) return res.status(500).send('Erreur de création du compte');
      res.redirect('/users');
    }
  );
});

app.post('/agencies', ensureAuthenticated, ensureAdmin, (req, res) => {
  const { name, city, address, phone } = req.body;

  if (!name || !city || !address) {
    return res.status(400).send('Nom, ville et adresse obligatoires');
  }

  const code = `AG-${uuidv4().slice(0, 4).toUpperCase()}`;
  db.run(
    'INSERT INTO agencies (code, name, city, address, phone, status) VALUES (?, ?, ?, ?, ?, ?)',
    [code, name, city, address, phone || '', 'ACTIVE'],
    (err) => {
      if (err) return res.status(500).send('Erreur de création d’agence');
      res.redirect('/agencies');
    }
  );
});

app.get('/shipments', ensureAuthenticated, (req, res) => {
  db.all('SELECT * FROM shipments ORDER BY created_at DESC', (err, shipments) => {
    if (err) return res.status(500).send('Erreur de lecture des colis');
    db.all('SELECT * FROM agencies ORDER BY name', (agencyErr, agencies) => {
      db.all('SELECT * FROM cities ORDER BY name', (cityErr, cities) => {
        res.render('shipments', {
          title: 'Colis',
          user: req.session.user,
          shipments: shipments || [],
          agencies: agencies || [],
          cities: cities || [],
          APP_TITLE
        });
      });
    });
  });
});

app.post('/shipments', ensureAuthenticated, (req, res) => {
  const {
    sender_name,
    sender_phone,
    sender_address,
    recipient_name,
    recipient_phone,
    recipient_city,
    recipient_address,
    weight,
    length,
    width,
    height,
    service,
    from_city,
    to_city,
    description,
    agency_id
  } = req.body;

  if (!sender_name || !recipient_name || !recipient_city || !from_city || !to_city || !weight) {
    return res.status(400).send('Veuillez compléter les informations essentielles du colis');
  }

  const pricing = calculatePrice({
    weight,
    length: length || 30,
    width: width || 20,
    height: height || 15,
    fromCity: from_city,
    toCity: to_city
  });

  const trackingCode = buildTrackingCode();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO shipments (
      tracking_code, sender_name, sender_phone, sender_address, recipient_name, recipient_phone,
      recipient_city, recipient_address, weight, length, width, height, service, description,
      from_city, to_city, amount, paid_amount, status, agency_id, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      trackingCode,
      sender_name,
      sender_phone || '',
      sender_address || '',
      recipient_name,
      recipient_phone || '',
      recipient_city,
      recipient_address || '',
      Number(weight),
      Number(length || 30),
      Number(width || 20),
      Number(height || 15),
      service || 'STANDARD',
      description || '',
      from_city,
      to_city,
      pricing.total,
      0,
      'ENREGISTRE',
      agency_id || 1,
      req.session.user.id,
      now,
      now
    ],
    function (err) {
      if (err) return res.status(500).send('Erreur de création du colis');
      const shipmentId = this.lastID;
      db.run('INSERT INTO shipment_events (shipment_id, status, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)', [shipmentId, 'ENREGISTRE', 'Colis créé et tarif figé.', now, req.session.user.id]);
      res.redirect('/shipments');
    }
  );
});

app.get('/payments', ensureAuthenticated, (req, res) => {
  db.all(
    `SELECT p.*, s.tracking_code, s.sender_name, s.recipient_name 
     FROM payments p LEFT JOIN shipments s ON s.id = p.shipment_id ORDER BY p.created_at DESC`,
    (err, payments) => {
      if (err) return res.status(500).send('Erreur de lecture des paiements');
      db.all('SELECT id, tracking_code, recipient_name, amount, paid_amount, status FROM shipments ORDER BY created_at DESC', (shipErr, shipments) => {
        res.render('payments', {
          title: 'Paiements',
          user: req.session.user,
          payments: payments || [],
          shipments: shipments || [],
          APP_TITLE
        });
      });
    }
  );
});

app.post('/payments', ensureAuthenticated, (req, res) => {
  const { shipment_id, amount, method, reference } = req.body;

  db.get('SELECT * FROM shipments WHERE id = ?', [shipment_id], (err, shipment) => {
    if (err || !shipment) return res.status(404).send('Colis introuvable');

    const paymentAmount = Number(amount);
    const newPaid = Number(shipment.paid_amount) + paymentAmount;
    const ref = reference || `PAY-${uuidv4().slice(0, 8).toUpperCase()}`;

    db.run(
      'INSERT INTO payments (shipment_id, amount, method, reference, status, agent_id) VALUES (?, ?, ?, ?, ?, ?)',
      [shipment.id, paymentAmount, method || 'ESPECE', ref, 'CONFIRMED', req.session.user.id],
      (paymentErr) => {
        if (paymentErr) return res.status(500).send('Erreur d’enregistrement du paiement');

        const status = newPaid >= Number(shipment.amount) ? 'PAYE' : 'EN_COURS';
        db.run('UPDATE shipments SET paid_amount = ?, status = ?, updated_at = ? WHERE id = ?', [newPaid, status, new Date().toISOString(), shipment.id], (updateErr) => {
          if (updateErr) return res.status(500).send('Erreur de mise à jour du colis');
          res.redirect('/payments');
        });
      }
    );
  });
});

app.get('/tracking', (req, res) => {
  res.render('tracking', {
    title: 'Suivi public',
    user: req.session.user || null,
    result: null,
    error: '',
    APP_TITLE
  });
});

app.post('/tracking', (req, res) => {
  const code = (req.body.code || '').trim();

  if (!code) {
    return res.render('tracking', {
      title: 'Suivi public',
      user: req.session.user || null,
      result: null,
      error: 'Veuillez fournir un code de suivi.',
      APP_TITLE
    });
  }

  db.get('SELECT * FROM shipments WHERE tracking_code = ?', [code], (err, shipment) => {
    if (err || !shipment) {
      return res.render('tracking', {
        title: 'Suivi public',
        user: req.session.user || null,
        result: null,
        error: 'Aucun colis trouvé pour ce code de suivi.',
        APP_TITLE
      });
    }

    db.all('SELECT * FROM shipment_events WHERE shipment_id = ? ORDER BY created_at ASC', [shipment.id], (eventErr, events) => {
      res.render('tracking', {
        title: 'Suivi public',
        user: req.session.user || null,
        result: {
          ...shipment,
          events: events || []
        },
        error: '',
        APP_TITLE
      });
    });
  });
});

app.use((req, res) => {
  res.status(404).render('404', { user: req.session.user || null, title: 'Page non trouvée', APP_TITLE });
});

initDatabase();

app.listen(port, () => {
  console.log(`COLIS SERVICE app is running on http://localhost:${port}`);
});
