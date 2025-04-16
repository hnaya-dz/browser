# HnayaDZ Browser

Hnaya DZ Browser is a desktop application built with Electron and Next.js, designed to provide a seamless browsing experience.

## Features

- **Electron Integration**: Combines the power of Electron with Next.js for a desktop application.
- **Multi-Platform Support**: Build and run on macOS, Windows, and Linux.
- **Internationalization**: Supports multiple languages using `i18next`.
- **Responsive Design**: Utilizes Tailwind CSS for styling.

## Getting Started

### Prerequisites

- Node.js (version 14 or higher)
- Yarn (for package management)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/HnayaDZ.git
   cd HnayaDZ
   ```

2. Install dependencies:
   ```bash
   yarn install
   ```

### Development

To start the development server, run:
```bash
yarn dev
```

This command will run both the Next.js development server and the Electron application.

### Building for Production

To build the application for production, run:
```bash
yarn build
```

Then, to create a distributable package, run:
```bash
yarn dist
```

### Running the Application

To start the application in production mode, use:
```bash
yarn start
```

## Scripts

- `dev`: Runs the application in development mode.
- `electron-dev`: Starts the Electron app with the development URL.
- `build`: Builds the Next.js application.
- `export`: Exports the Next.js application.
- `start`: Runs the application in production mode.
- `dist`: Builds the application and creates a distributable package.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License.