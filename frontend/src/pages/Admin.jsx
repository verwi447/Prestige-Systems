import { useEffect, useState } from "react";
import { admin as adminAPI } from "../api";
import ConfirmationModal from "../components/ConfirmationModal";

export default function Admin() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [tab, setTab] = useState("stats");
  const [userToDelete, setUserToDelete] = useState(null);
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "USER" });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const statsRes = await adminAPI.getStats();
      setStats(statsRes.data);

      const usersRes = await adminAPI.getUsers();
      setUsers(usersRes.data);

      const activitiesRes = await adminAPI.getActivities();
      setActivities(activitiesRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  const createUser = async () => {
    if (!newUser.username.trim() || !newUser.password.trim()) {
      alert("Podaj login i hasło");
      return;
    }

    try {
      await adminAPI.createUser(newUser);
      setNewUser({ username: "", password: "", role: "USER" });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || "Błąd przy tworzeniu użytkownika");
    }
  };

  const updateUserRole = async (userId, role) => {
    try {
      await adminAPI.updateUserRole(userId, role);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || "Błąd przy aktualizacji roli");
    }
  };

  const deleteUser = async () => {
    if (!userToDelete) return;
    try {
      await adminAPI.deleteUser(userToDelete.id);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || "Błąd przy usuwaniu użytkownika");
    } finally {
      setUserToDelete(null);
    }
  };

  return (
    <div className="page">
      <h1>Panel administracyjny</h1>

      <div className="tabs">
        <button className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>
          Statystyki
        </button>
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>
          Użytkownicy
        </button>
        <button className={tab === "activities" ? "active" : ""} onClick={() => setTab("activities")}>
          Aktywności
        </button>
      </div>

      {tab === "stats" && stats && (
        <div className="stats">
          <div className="stat-card">
            <h3>Oferty: {stats.totalOffers}</h3>
          </div>
          <div className="stat-card">
            <h3>Obiekty: {stats.totalObjects}</h3>
          </div>
          <div className="stat-card">
            <h3>Użytkownicy: {stats.totalUsers}</h3>
          </div>

          <h3>Oferty wg statusu</h3>
          <ul>
            {stats.offersByStatus?.map((status) => (
              <li key={status.status}>{status.status}: {status.count}</li>
            ))}
          </ul>
        </div>
      )}

      {tab === "users" && (
        <>
          <div className="form-container">
            <h3>Dodaj użytkownika</h3>
            <div className="three-column-form">
              <input
                type="text"
                placeholder="Login"
                value={newUser.username}
                onChange={(event) => setNewUser({ ...newUser, username: event.target.value })}
              />
              <input
                type="password"
                placeholder="Hasło"
                value={newUser.password}
                onChange={(event) => setNewUser({ ...newUser, password: event.target.value })}
              />
              <select
                value={newUser.role}
                onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}
              >
                <option value="USER">Użytkownik</option>
                <option value="ADMIN">Administrator</option>
              </select>
            </div>
            <button className="btn btn-success" onClick={createUser}>Dodaj użytkownika</button>
          </div>

          <div className="users-table table-container">
            <table>
              <thead>
                <tr>
                  <th>Użytkownik</th>
                  <th>Rola</th>
                  <th>Data utworzenia</th>
                  <th>Akcje</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      {user.username}
                      {user.is_permanent && <span className="locked-account">Stałe konto</span>}
                    </td>
                    <td>
                      <select
                        value={user.role}
                        disabled={user.is_permanent}
                        onChange={(event) => updateUserRole(user.id, event.target.value)}
                      >
                        <option>USER</option>
                        <option>ADMIN</option>
                      </select>
                    </td>
                    <td>{new Date(user.created_at).toLocaleDateString("pl-PL")}</td>
                    <td>
                      <button
                        className="btn-delete btn-sm"
                        disabled={user.is_permanent}
                        onClick={() => setUserToDelete(user)}
                      >
                        Usuń
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "activities" && (
        <div className="activities">
          <h3>Ostatnie aktywności</h3>
          {activities.map((activity, idx) => (
            <div key={idx} className="activity">
              <strong>{activity.username}</strong> - {activity.type}
              <p>{activity.description}</p>
              <small>{new Date(activity.timestamp).toLocaleString("pl-PL")}</small>
            </div>
          ))}
        </div>
      )}

      <ConfirmationModal
        isOpen={!!userToDelete}
        onClose={() => setUserToDelete(null)}
        onConfirm={deleteUser}
        title="Potwierdź usunięcie"
        confirmText="Usuń"
      >
        <p>Czy na pewno chcesz usunąć użytkownika <strong>{userToDelete?.username}</strong>?</p>
        <p>Ta operacja jest nieodwracalna.</p>
      </ConfirmationModal>
    </div>
  );
}
