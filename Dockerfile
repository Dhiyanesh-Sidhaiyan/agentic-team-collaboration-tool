# Use the official Node.js 20 image as the base image
FROM node:20-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 8080

# Define the environment variable for the port
ENV PORT=8080

# Command to run the application
CMD [ "npm", "start" ]
