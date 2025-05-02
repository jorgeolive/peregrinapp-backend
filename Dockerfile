FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy app source
COPY *.js ./

# Create directory for static files
RUN mkdir -p public

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["node", "index.js"] 