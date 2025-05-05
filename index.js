require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();

const SECRET_KEY = process.env.SECRET_KEY;
const PORT = 3005;
let db, usersCollection, customersCollection, loansCollection, repaymentsCollection;

app.use(express.json());
app.use(cors({ origin: '*' }));

const uri = 'mongodb+srv://charan333gt:dxIFPPQ3MDGcc4DZ@cluster0.ezgqv.mongodb.net/';
const client = new MongoClient(uri);

// Connect to MongoDB
client.connect()
  .then((client) => {
    db = client.db('CrediKhaataDB');
    usersCollection = db.collection('users');
    customersCollection = db.collection('customers');
    loansCollection = db.collection('loans');
    repaymentsCollection = db.collection('repayments');
    console.log('Connected to MongoDB database');
  })
  .catch((error) => {
    console.error('Error connecting to the database:', error);
  });

// User Registration
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).send({ message: 'Email and Password are required.' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  
  try {
    const result = await usersCollection.insertOne({ email, password: hashedPassword });
    res.status(201).send({ message: 'User registered successfully', userId: result.insertedId });
  } catch (err) {
    console.error('Error registering user:', err);
    res.status(500).send({ message: 'Server error', error: err.message });
  }
});

// User Login and JWT Token
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).send({ message: 'Email and Password are required.' });
  }

  const user = await usersCollection.findOne({ email });
  if (!user) {
    return res.status(400).send({ message: 'Invalid credentials' });
  }

  const isPasswordMatch = await bcrypt.compare(password, user.password);
  if (!isPasswordMatch) {
    return res.status(400).send({ message: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user._id }, SECRET_KEY, { expiresIn: '1h' });
  res.status(200).send({ message: 'Login successful', token });
});

// Middleware to authenticate user
const authenticate = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    return res.status(403).send({ message: 'No token provided' });
  }

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: 'Invalid token' });
    }
    req.userId = decoded.userId;
    next();
  });
};

// Add Customer
app.post('/customers', authenticate, async (req, res) => {
  const { name, phone, address, trustScore, creditLimit } = req.body;

  if (!name || !phone || !creditLimit) {
    return res.status(400).send({ message: 'Name, phone, and credit limit are required' });
  }

  try {
    const result = await customersCollection.insertOne({
      userId: req.userId,
      name,
      phone,
      address,
      trustScore: trustScore || 5,
      creditLimit,
    });
    res.status(201).send({ message: 'Customer added successfully', customerId: result.insertedId });
  } catch (err) {
    console.error('Error adding customer:', err);
    res.status(500).send({ message: 'Server error', error: err.message });
  }
});

// Create Loan (Credit Sale)
app.post('/loans', authenticate, async (req, res) => {
  const { customerId, itemDescription, loanAmount, dueDate, frequency, interestRate, graceDays } = req.body;

  if (!customerId || !itemDescription || !loanAmount || !dueDate || !frequency) {
    return res.status(400).send({ message: 'Missing required fields' });
  }

  try {
    const result = await loansCollection.insertOne({
      userId: req.userId,
      customerId,
      itemDescription,
      loanAmount,
      issueDate: new Date(),
      dueDate,
      frequency,
      interestRate: interestRate || 0,
      graceDays: graceDays || 0,
      balance: loanAmount,
      status: 'pending',
    });
    res.status(201).send({ message: 'Loan created successfully', loanId: result.insertedId });
  } catch (err) {
    console.error('Error creating loan:', err);
    res.status(500).send({ message: 'Server error', error: err.message });
  }
});

// Record Repayment
app.post('/repayments', authenticate, async (req, res) => {
  const { loanId, repaymentAmount } = req.body;

  if (!loanId || !repaymentAmount) {
    return res.status(400).send({ message: 'Loan ID and repayment amount are required' });
  }

  try {
    const loan = await loansCollection.findOne({ _id:  new ObjectId(loanId), userId: req.userId });
    if (!loan) {
      return res.status(404).send({ message: 'Loan not found' });
    }

    const newBalance = loan.balance - repaymentAmount;
    const status = newBalance <= 0 ? 'paid' : 'pending';

    await loansCollection.updateOne({ _id: new ObjectId(loanId) }, { $set: { balance: newBalance, status } });
    await repaymentsCollection.insertOne({ userId: req.userId, loanId, repaymentAmount, repaymentDate: new Date() });

    res.status(200).send({ message: 'Repayment recorded successfully' });
  } catch (err) {
    console.error('Error recording repayment:', err);
    res.status(500).send({ message: 'Server error', error: err.message });
  }
});

// Get Loan Summary
app.get('/summary', authenticate, async (req, res) => {
  try {
    const loans = await loansCollection.find({ userId: req.userId }).toArray();
    const totalLoaned = loans.reduce((acc, loan) => acc + loan.loanAmount, 0);
    const totalCollected = loans.reduce((acc, loan) => acc + (loan.loanAmount - loan.balance), 0);
    const overdueAmount = loans.filter((loan) => loan.status === 'overdue').reduce((acc, loan) => acc + loan.balance, 0);
    const avgRepaymentTime = loans.length > 0 ? loans.reduce((acc, loan) => acc + (new Date() - new Date(loan.issueDate)), 0) / loans.length : 0;

    res.status(200).send({
      totalLoaned,
      totalCollected,
      overdueAmount,
      avgRepaymentTime,
    });
  } catch (err) {
    console.error('Error fetching summary:', err);
    res.status(500).send({ message: 'Server error', error: err.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});





// GET: /overdue – list customers with overdue loans
app.get('/overdue', authenticate, async (req, res) => {
  try {
    const today = new Date();

    // Step 1: Find all loans for the current shopkeeper
    const loans = await loansCollection.find({ userId: req.userId }).toArray();

    let overdueLoanIds = [];

    // Step 2: Auto-tag overdue loans
    for (let loan of loans) {
      if (
        new Date(loan.dueDate) < today &&
        loan.balance > 0 &&
        loan.status !== 'overdue'
      ) {
        await loansCollection.updateOne(
          { _id: loan._id },
          { $set: { status: 'overdue' } }
        );
        overdueLoanIds.push(loan._id.toString());
      }
    }

    // Step 3: Get all overdue loans
    const overdueLoans = await loansCollection.find({
      userId: req.userId,
      status: 'overdue'
    }).toArray();

    const customerIds = [...new Set(overdueLoans.map(loan => loan.customerId.toString()))];

    const overdueCustomers = await customersCollection.find({
      _id: { $in: customerIds.map(id => new ObjectId(id)) }
    }).toArray();

    res.status(200).send({
      overdueLoanCount: overdueLoans.length,
      overdueCustomers
    });
  } catch (err) {
    console.error('Error fetching overdue loans:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

