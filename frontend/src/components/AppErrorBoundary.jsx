import { Component } from "react";
import AppState from "./AppState";
import "./AppErrorBoundary.css";

export default class AppErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Nieobsluzony blad interfejsu", error, errorInfo);
  }

  retry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="application-error-boundary">
        <AppState
          variant="error"
          title="Nie udalo sie wyswietlic tego widoku"
          description="Blad interfejsu nie zmienil Twoich danych. Sprobuj ponownie lub odswiez aplikacje."
          action={(
            <div className="application-error-actions">
              <button type="button" onClick={this.retry}>Sprobuj ponownie</button>
              <button type="button" onClick={() => window.location.reload()}>Odswiez aplikacje</button>
            </div>
          )}
        />
      </main>
    );
  }
}
