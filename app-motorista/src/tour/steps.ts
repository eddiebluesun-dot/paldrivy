export interface TourStep {
  id: string;
  targetId: string; // matches a TourTarget's id
  titleKey: string;
  descriptionKey: string;
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'vehicle-pill', targetId: 'vehicle-pill', titleKey: 'tour.vehicle_pill_title', descriptionKey: 'tour.vehicle_pill_desc' },
  { id: 'goal-card', targetId: 'goal-card', titleKey: 'tour.goal_card_title', descriptionKey: 'tour.goal_card_desc' },
  { id: 'summary-cards', targetId: 'summary-cards', titleKey: 'tour.summary_cards_title', descriptionKey: 'tour.summary_cards_desc' },
  { id: 'quickadd-button', targetId: 'quickadd-button', titleKey: 'tour.quickadd_title', descriptionKey: 'tour.quickadd_desc' },
  { id: 'tab-shifts', targetId: 'tab-shifts', titleKey: 'tour.tab_shifts_title', descriptionKey: 'tour.tab_shifts_desc' },
  { id: 'tab-community', targetId: 'tab-community', titleKey: 'tour.tab_community_title', descriptionKey: 'tour.tab_community_desc' },
  { id: 'tab-more', targetId: 'tab-more', titleKey: 'tour.tab_more_title', descriptionKey: 'tour.tab_more_desc' },
];
