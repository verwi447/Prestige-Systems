import { useState, useEffect } from 'react';
import { templates as templatesAPI } from '../api';
import './Templates.css';

const initialItem = { title: '', description: '', unit_price: 0, quantity: 1 };

export default function Templates() {
    const [templates, setTemplates] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        items: [initialItem]
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchTemplates();
    }, []);

    const fetchTemplates = async () => {
        setLoading(true);
        try {
            const res = await templatesAPI.getAll();
            setTemplates(res.data);
        } catch (err) {
            console.error(err);
            setError('Nie udało się załadować szablonów.');
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleItemChange = (index, field, value) => {
        const newItems = [...formData.items];
        newItems[index] = { ...newItems[index], [field]: value };
        setFormData(prev => ({ ...prev, items: newItems }));
    };

    const handleAddItem = () => {
        setFormData(prev => ({ ...prev, items: [...prev.items, { ...initialItem }] }));
    };

    const handleRemoveItem = (index) => {
        const newItems = formData.items.filter((_, i) => i !== index);
        setFormData(prev => ({ ...prev, items: newItems }));
    };

    const resetForm = () => {
        setFormData({ name: '', description: '', items: [initialItem] });
        setShowForm(false);
        setError(null);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!formData.name.trim()) {
            setError('Nazwa szablonu jest wymagana.');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const payload = {
                ...formData,
                items: formData.items.map(item => ({
                    ...item,
                    unit_price: parseFloat(item.unit_price) || 0,
                    quantity: parseInt(item.quantity) || 1,
                })).filter(item => item.title.trim() !== '')
            };
            await templatesAPI.create(payload);
            resetForm();
            fetchTemplates();
        } catch (err) {
            setError(err.response?.data?.error || 'Wystąpił błąd podczas zapisu szablonu.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (templateId) => {
        if (window.confirm('Czy na pewno chcesz usunąć ten szablon?')) {
            try {
                await templatesAPI.delete(templateId);
                fetchTemplates();
            } catch (err) {
                alert(err.response?.data?.error || 'Nie udało się usunąć szablonu.');
                console.error(err);
            }
        }
    };

    return (
        <div className="page templates-page">
            <div className="page-header">
                <h1>Zarządzanie szablonami ofert</h1>
                <button onClick={() => setShowForm(true)} className="btn-primary">
                    + Nowy szablon
                </button>
            </div>

            {showForm && (
                <div className="modal-overlay">
                    <div className="modal-content template-form">
                        <form onSubmit={handleSave}>
                            <h2>Nowy szablon</h2>
                            {error && <p className="error-message">{error}</p>}
                            <div className="form-group">
                                <label>Nazwa szablonu</label>
                                <input type="text" name="name" value={formData.name} onChange={handleInputChange} placeholder="np. Serwis roczny systemu" required />
                            </div>
                            <div className="form-group">
                                <label>Opis (opcjonalnie)</label>
                                <textarea name="description" value={formData.description} onChange={handleInputChange} rows="2" />
                            </div>

                            <h3>Pozycje w szablonie</h3>
                            <div className="template-items-editor">
                                {formData.items.map((item, index) => (
                                    <div key={index} className="template-item-row">
                                        <input type="text" placeholder="Nazwa pozycji" value={item.title} onChange={e => handleItemChange(index, 'title', e.target.value)} />
                                        <input type="number" placeholder="Ilość" value={item.quantity} onChange={e => handleItemChange(index, 'quantity', e.target.value)} />
                                        <input type="number" step="0.01" placeholder="Cena jedn." value={item.unit_price} onChange={e => handleItemChange(index, 'unit_price', e.target.value)} />
                                        <button type="button" onClick={() => handleRemoveItem(index)} className="btn-delete btn-sm">X</button>
                                    </div>
                                ))}
                            </div>
                            <button type="button" onClick={handleAddItem} className="btn-secondary btn-sm">+ Dodaj pozycję</button>

                            <div className="form-actions">
                                <button type="submit" disabled={loading} className="btn-success">{loading ? 'Zapisywanie...' : 'Zapisz szablon'}</button>
                                <button type="button" onClick={resetForm} className="btn-cancel">Anuluj</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <div className="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Nazwa szablonu</th>
                            <th>Opis</th>
                            <th>Data utworzenia</th>
                            <th>Akcje</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && !templates.length ? (
                            <tr><td colSpan="4">Ładowanie...</td></tr>
                        ) : templates.length === 0 ? (
                            <tr><td colSpan="4" className="empty-state">Brak zdefiniowanych szablonów. Utwórz pierwszy!</td></tr>
                        ) : (
                            templates.map(template => (
                                <tr key={template.id}>
                                    <td>{template.name}</td>
                                    <td>{template.description}</td>
                                    <td>{new Date(template.created_at).toLocaleDateString('pl-PL')}</td>
                                    <td className="actions">
                                        <button onClick={() => handleDelete(template.id)} className="btn-delete btn-sm">Usuń</button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}