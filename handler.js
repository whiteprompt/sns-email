const EmailReplyParser = require('email-reply-parser');
const JWT = require('jsonwebtoken');
const {v4: uuid} = require('uuid');
const {DynamoDB} = require('aws-sdk');

const {AUTH_SECRET, ADMIN_USER, ADMIN_PASSWORD, REGION, TABLE_NAME, NODE_ENV} = process.env;

const sign = (data) => new Promise((resolve, reject) => {
  JWT.sign(data, AUTH_SECRET, {algorithm: 'HS256'}, (error, token) => {
    if (error) {
      reject(error);
    } else {
      resolve(token);
    }
  });
});

const generatePolicy = (principalId, effect, resource) => {
  const authResponse = {};
  authResponse.principalId = principalId;
  if (effect && resource) {
    const policyDocument = {};
    policyDocument.Version = '2012-10-17';
    policyDocument.Statement = [];
    const statementOne = {};
    statementOne.Action = 'execute-api:Invoke';
    statementOne.Effect = effect;
    statementOne.Resource = resource;
    policyDocument.Statement[0] = statementOne;
    authResponse.policyDocument = policyDocument;
  }
  return authResponse;
};

const dynamoDBOptions = {region: REGION};

if (NODE_ENV === 'development') {
  dynamoDBOptions.region = 'localhost';
  dynamoDBOptions.endpoint = 'http://localhost:8000';
}

const db = new DynamoDB.DocumentClient(dynamoDBOptions);

module.exports = {
  async login(event) {
    let statusCode;
    let body;
    let token;
    const {user, password} = JSON.parse(event.body);
    try {
      const isAdmin = user === ADMIN_USER && password === ADMIN_PASSWORD;
      const userData = isAdmin ? {user, admin: true} : false;
      if (userData) {
        token = await sign(userData);
        statusCode = 200;
        body = {ok: true, token};
      } else {
        statusCode = 401;
        body = {ok: false, error: 'Not Authorized'};
      }
    } catch (e) {
      logError(e);
      statusCode = 401;
      body = {ok: false, error: e};
    }
    return {statusCode, body: JSON.stringify(body, null, 2)};
  },
  async authorize(event, context, callback) {
    if (typeof event.authorizationToken === 'undefined') {
      callback('Unauthorized');
    }

    const split = event.authorizationToken.split('Bearer');

    if (split.length !== 2) {
      callback('Unauthorized');
    }

    const token = split[1].trim();

    JWT.verify(token, AUTH_SECRET, (error, decoded) => {
      console.log('authenticateAdmin', decoded);

      if (error || !decoded.admin) {
        callback('Unauthorized');
      } else {
        callback(null, generatePolicy(decoded.user, 'Allow', event.methodArn));
      }
    });
  },
  async parseEmail(event) {
    const {content, mail: {destination, source}} = JSON.parse(event.Records[0].Sns.Message);
    const email = new EmailReplyParser().parseReply(content);
    const [receiver] = destination[0].split('@');
    const [_, id] = receiver.split('+');

    console.log(destination);
    console.log(source);
    console.log(email);
    console.log(receiver);
    console.log(id);

    const addEmailToSubscriptionParams = {
      TableName: TABLE_NAME,
      Key: { id },
      UpdateExpression: 'set #e = list_append(:e, #e)',
      ExpressionAttributeNames: {
        '#e': 'emails'
      },
      ExpressionAttributeValues: {
        ':e': [source]
      },
      ReturnValues: 'UPDATED_NEW'
    };

    return db.update(addEmailToSubscriptionParams).promise();

  },
  async createEmailSubscription(event) {
    let statusCode = 200;
    let body;
    const data = JSON.parse(event.body)
    const id = data.id || uuid();
    const newEmailSubscriptionParams = {
      TableName: TABLE_NAME,
      Item: {
        ...data,
        id,
        emails: [],
        lastUpdatedAt: Date.now()
      },
    };

    try {
      await db.put(newEmailSubscriptionParams).promise();
      body = { ok: true, data: newEmailSubscriptionParams.Item };
    } catch (e) {
      console.log('ERROR', e);
      statusCode = 500;
      body = { ok: false, error: e.message };
    }

    return { statusCode, body: JSON.stringify(body, null, 2) }
  }
};
